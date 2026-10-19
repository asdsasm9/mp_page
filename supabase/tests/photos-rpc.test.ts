import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sumBytes, type PhotoVariants } from '../../packages/shared/src/variants';
import { asRole, createMigratedDb } from './helpers/db';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const CAT = 'aaaaaaaa-0000-4000-8000-000000000001';
const ALB = 'bbbbbbbb-0000-4000-8000-000000000001';
const ALB2 = 'bbbbbbbb-0000-4000-8000-000000000002';
const id = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;

const VARIANTS: PhotoVariants = {
  master: { w: 3000, h: 2000, bytes: 1_000_000 },
  webp: [
    { tier: 480, w: 480, h: 320, bytes: 30_000 },
    { tier: 960, w: 960, h: 640, bytes: 90_000 },
  ],
  jpeg: { w: 1600, h: 1067, bytes: 300_000 },
  og: { w: 1200, h: 630, bytes: 120_000 },
};
const TOTAL = sumBytes(VARIANTS); // 1_540_000

let db: PGlite;
const asAdmin = <T>(fn: (d: PGlite) => Promise<T>) => asRole(db, 'authenticated', fn, ADMIN);

interface Reg {
  id?: string;
  album?: string;
  variants?: unknown;
  total?: number;
  legacy?: string | null;
  alt?: string | null;
}
const register = (r: Reg = {}) =>
  asAdmin((d) =>
    d.query<{ r: Record<string, unknown> }>(
      `select public.register_photo($1::uuid, $2::uuid, 3000, 2000, $3::jsonb, $4::bigint, '#aabbcc', $5, $6) as r`,
      [r.id ?? id(1), r.album ?? ALB, JSON.stringify(r.variants ?? VARIANTS), r.total ?? TOTAL, r.alt ?? null, r.legacy ?? null],
    ),
  );
const count = async () => (await db.query<{ n: number }>('select count(*)::int as n from public.photos')).rows[0].n;
const usage = async () =>
  (await asAdmin((d) => d.query<{ u: { used_bytes: number } }>('select public.storage_usage() as u'))).rows[0].u;

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN}', 'a@example.test'), ('${OTHER}', 'o@example.test');
    insert into public.admins (user_id) values ('${ADMIN}');
    insert into public.categories (id, slug, name) values ('${CAT}', 'svatby', 'Svatby');
    insert into public.albums (id, category_id, slug, title) values
      ('${ALB}', '${CAT}', 'one', 'One'), ('${ALB2}', '${CAT}', 'two', 'Two');
  `);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec(`
    delete from public.upload_reservations;
    delete from public.photos;
    update public.app_config set quota_hard_bytes = 9500000000, quota_warn_bytes = 8000000000;
  `);
});

describe('register_photo', () => {
  it('registers a photo: derived key, bytes_total equals sumBytes, sort step 10', async () => {
    const row = (await register()).rows[0].r;
    expect(row).toMatchObject({
      id: id(1),
      album_id: ALB,
      master_key: `photos/${id(1)}/master.jpg`,
      bytes_total: sumBytes(VARIANTS),
      dominant_color: '#aabbcc',
      sort: 10,
      already_existed: false,
    });
    const second = (await register({ id: id(2) })).rows[0].r;
    expect(second.sort).toBe(20);
    const other = (await register({ id: id(3), album: ALB2 })).rows[0].r;
    expect(other.sort).toBe(10);
    expect((await usage()).used_bytes).toBe(3 * TOTAL);
  });

  it('a wrong total raises BYTES_MISMATCH', async () => {
    await expect(register({ total: TOTAL + 1 })).rejects.toThrow('BYTES_MISMATCH');
    expect(await count()).toBe(0);
  });

  it('a malformed variants object raises BYTES_MISMATCH', async () => {
    await expect(register({ variants: { master: { bytes: 5 } }, total: 5 })).rejects.toThrow('BYTES_MISMATCH');
    await expect(register({ variants: [], total: 0 })).rejects.toThrow('BYTES_MISMATCH');
  });

  it('over quota raises STORAGE_FULL even with no reservation', async () => {
    await db.exec(`update public.app_config set quota_hard_bytes = ${TOTAL - 1}, quota_warn_bytes = 1000`);
    await expect(register()).rejects.toThrow('STORAGE_FULL');
    expect(await count()).toBe(0);
  });

  it('exactly at the limit is accepted, one more photo is refused', async () => {
    await db.exec(`update public.app_config set quota_hard_bytes = ${TOTAL}, quota_warn_bytes = 1000`);
    await register();
    await expect(register({ id: id(2) })).rejects.toThrow('STORAGE_FULL');
  });

  it('other reservations count against the quota, the own reservation does not and is consumed', async () => {
    await db.exec(`update public.app_config set quota_hard_bytes = ${TOTAL + 100}, quota_warn_bytes = 1000`);
    await db.exec(
      `insert into public.upload_reservations (photo_id, bytes, expires_at)
       values ('${id(9)}', 50, now() + interval '1 hour'), ('${id(1)}', ${TOTAL}, now() + interval '1 hour')`,
    );
    await expect(register({ id: id(2) })).rejects.toThrow('STORAGE_FULL');
    await register({ id: id(1) });
    const left = await db.query(`select 1 from public.upload_reservations where photo_id = '${id(1)}'`);
    expect(left.rows).toHaveLength(0);
  });

  it('expired reservations of others do not count', async () => {
    await db.exec(`update public.app_config set quota_hard_bytes = ${TOTAL + 100}, quota_warn_bytes = 1000`);
    await db.exec(
      `insert into public.upload_reservations (photo_id, bytes, expires_at)
       values ('${id(9)}', 5000, now() - interval '1 minute')`,
    );
    await expect(register()).resolves.toBeDefined();
  });

  it('is idempotent for the same id: already_existed and no new row', async () => {
    const first = (await register()).rows[0].r;
    const again = (await register()).rows[0].r;
    expect(again).toMatchObject({ id: first.id, already_existed: true, sort: first.sort });
    expect(await count()).toBe(1);
  });

  it('the same id with different data raises CONFLICT', async () => {
    await register();
    await expect(register({ album: ALB2 })).rejects.toThrow('CONFLICT');
    const other = { ...VARIANTS, og: { ...VARIANTS.og, bytes: 1 } };
    await expect(register({ variants: other, total: sumBytes(other) })).rejects.toThrow('CONFLICT');
  });

  it('a known legacy_key with a new id returns the original row', async () => {
    const first = (await register({ legacy: 'svatby/sedlakovi/1.jpg' })).rows[0].r;
    const again = (await register({ id: id(2), legacy: 'svatby/sedlakovi/1.jpg' })).rows[0].r;
    expect(again).toMatchObject({ id: first.id, already_existed: true });
    expect(await count()).toBe(1);
  });

  it('an unknown album raises ALBUM_NOT_FOUND', async () => {
    await expect(register({ album: id(77) })).rejects.toThrow('ALBUM_NOT_FOUND');
  });

  it('there is no key parameter to trust', async () => {
    const r = await db.query<{ args: string }>(
      `select pg_get_function_arguments(oid) as args from pg_proc where proname = 'register_photo'`,
    );
    expect(r.rows[0].args).not.toMatch(/key,/);
    expect(r.rows[0].args).not.toMatch(/p_master_key/);
  });
});

describe('delete_photos', () => {
  it('returns the deleted master keys, lowers usage and clears a cover', async () => {
    await register();
    await register({ id: id(2) });
    await db.exec(`update public.albums set cover_photo_id = '${id(1)}' where id = '${ALB}'`);
    expect((await usage()).used_bytes).toBe(2 * TOTAL);

    const out = (
      await asAdmin((d) =>
        d.query<{ r: { deleted: Array<{ id: string; master_key: string }> } }>(
          `select public.delete_photos($1::uuid[]) as r`,
          [`{${id(1)},${id(88)}}`],
        ),
      )
    ).rows[0].r;
    expect(out.deleted).toEqual([{ id: id(1), master_key: `photos/${id(1)}/master.jpg` }]);
    expect((await usage()).used_bytes).toBe(TOTAL);
    const cover = await db.query<{ c: string | null }>(`select cover_photo_id as c from public.albums where id = '${ALB}'`);
    expect(cover.rows[0].c).toBeNull();
  });

  it('an empty or null list deletes nothing', async () => {
    await register();
    const r = await asAdmin((d) => d.query<{ r: { deleted: unknown[] } }>(`select public.delete_photos(null) as r`));
    expect(r.rows[0].r.deleted).toEqual([]);
    expect(await count()).toBe(1);
  });
});

describe('photos rpc: access and grants', () => {
  it('a non-admin is refused on both functions (NOT_ADMIN, 42501)', async () => {
    const reg = asRole(
      db,
      'authenticated',
      (d) =>
        d.query(`select public.register_photo($1::uuid, $2::uuid, 1, 1, $3::jsonb, $4::bigint)`, [
          id(1), ALB, JSON.stringify(VARIANTS), TOTAL,
        ]),
      OTHER,
    );
    await expect(reg).rejects.toThrow('NOT_ADMIN');
    const del = asRole(db, 'authenticated', (d) => d.query(`select public.delete_photos('{}'::uuid[])`), OTHER);
    await expect(del).rejects.toMatchObject({ code: '42501' });
  });

  it('anon cannot execute either function', async () => {
    await expect(
      asRole(db, 'anon', (d) => d.query(`select public.delete_photos('{}'::uuid[])`)),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asRole(db, 'anon', (d) =>
        d.query(`select public.register_photo($1::uuid, $2::uuid, 1, 1, '{}'::jsonb, 0::bigint)`, [id(1), ALB]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('a direct insert or delete on photos by an admin is still refused (D-5)', async () => {
    await register();
    await expect(
      asAdmin((d) =>
        d.query(
          `insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total)
           values ('${id(5)}', '${ALB}', 'photos/${id(5)}/master.jpg', 1, 1, '{}', 0)`,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(asAdmin((d) => d.query(`delete from public.photos`))).rejects.toThrow(/permission denied/);
  });

  it('the helper variants_bytes_sum is not callable by API roles', async () => {
    await expect(
      asAdmin((d) => d.query(`select public.variants_bytes_sum('{}'::jsonb)`)),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
