import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asRole, createMigratedDb, seedAdmin } from './helpers/db';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const CAT = 'aaaaaaaa-0000-4000-8000-000000000001';
const ALB = 'bbbbbbbb-0000-4000-8000-000000000001';
const id = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;

const variants = (o: { master?: number; webp?: number[]; jpeg?: number; og?: number } = {}) => ({
  master: { w: 3000, h: 2000, bytes: o.master ?? 1_000_000 },
  webp: (o.webp ?? [30_000, 90_000]).map((bytes, i) => ({ tier: 480 * (i + 1), w: 480, h: 320, bytes })),
  jpeg: { w: 1600, h: 1067, bytes: o.jpeg ?? 300_000 },
  og: { w: 1200, h: 630, bytes: o.og ?? 120_000 },
});

let db: PGlite;
const asAdmin = <T>(fn: (d: PGlite) => Promise<T>) => asRole(db, 'authenticated', fn, ADMIN);

const register = (pid: string | null, v: unknown, total: number) =>
  asAdmin((d) =>
    d.query(`select public.register_photo($1::uuid, $2::uuid, 3000, 2000, $3::jsonb, $4::bigint) as r`, [
      pid,
      ALB,
      JSON.stringify(v),
      total,
    ]),
  );
const reserve = (items: unknown) =>
  asAdmin((d) => d.query<{ r: { results: unknown[] } }>('select public.reserve_uploads($1::jsonb) as r', [JSON.stringify(items)]));
const requestPublish = () =>
  asAdmin((d) => d.query<{ r: { log_id: string } }>('select public.request_publish() as r'));
const record = (logId: string, seen: number | null) =>
  asAdmin((d) =>
    d.query<{ r: { pending_changes: number } }>(
      `select public.record_publish($1::uuid, 'ok', $2, 1, 1, 1, null) as r`,
      [logId, seen],
    ),
  );

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN}', 'a@example.test');
    insert into public.categories (id, slug, name) values ('${CAT}', 'svatby', 'Svatby');
    insert into public.albums (id, category_id, slug, title) values ('${ALB}', '${CAT}', 'one', 'One');
  `);
  await seedAdmin(db, ADMIN, 'a@example.test');
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec(`
    delete from public.upload_reservations;
    delete from public.photos;
    delete from public.publish_log;
    update public.site_state set pending_changes = 0, last_publish_requested_at = null;
  `);
});

describe('variants_bytes_sum rejects negative components', () => {
  const sum = async (v: unknown) =>
    (await db.query<{ s: string | null }>('select public.variants_bytes_sum($1::jsonb)::text as s', [JSON.stringify(v)])).rows[0].s;

  it('still sums a valid object', async () => {
    expect(await sum(variants())).toBe('1540000');
  });
  it('returns null for a negative master, jpeg, og or webp entry', async () => {
    expect(await sum(variants({ master: -1 }))).toBeNull();
    expect(await sum(variants({ jpeg: -1 }))).toBeNull();
    expect(await sum(variants({ og: -1 }))).toBeNull();
    expect(await sum(variants({ webp: [500_000, -400_000] }))).toBeNull();
  });
  it('register_photo raises BYTES_MISMATCH even when the claimed total equals the negative sum', async () => {
    const v = variants({ master: -500_000 });
    await expect(register(id(1), v, 40_000 + 90_000 + 300_000 + 120_000 - 500_000)).rejects.toThrow('BYTES_MISMATCH');
    const w = variants({ webp: [500_000, -400_000] });
    await expect(register(id(1), w, 1_000_000 + 100_000 + 300_000 + 120_000)).rejects.toThrow('BYTES_MISMATCH');
    expect((await db.query('select 1 from public.photos')).rows).toHaveLength(0);
  });
});

describe('record_publish uses the stored pending_seen', () => {
  it('ignores a caller value larger than the stored one', async () => {
    await db.exec('update public.site_state set pending_changes = 5');
    const { log_id } = (await requestPublish()).rows[0].r;
    await db.exec('update public.site_state set pending_changes = pending_changes + 2');
    expect((await record(log_id, 999)).rows[0].r.pending_changes).toBe(2);
  });
  it('ignores a caller value smaller than the stored one, and a null', async () => {
    await db.exec('update public.site_state set pending_changes = 5');
    const a = (await requestPublish()).rows[0].r.log_id;
    expect((await record(a, 0)).rows[0].r.pending_changes).toBe(0);
    await db.exec(`update public.site_state set pending_changes = 3, last_publish_requested_at = null`);
    const b = (await requestPublish()).rows[0].r.log_id;
    expect((await record(b, null)).rows[0].r.pending_changes).toBe(0);
  });
  it('keeps the stored pending_seen on the log row', async () => {
    await db.exec('update public.site_state set pending_changes = 4');
    const { log_id } = (await requestPublish()).rows[0].r;
    await record(log_id, 123);
    const r = await db.query<{ p: number }>(`select pending_seen as p from public.publish_log where id = '${log_id}'`);
    expect(r.rows[0].p).toBe(4);
  });
});

describe('register_photo and reserve_uploads input checks', () => {
  it('register_photo raises INVALID_ID for a null id', async () => {
    await expect(register(null, variants(), 1_540_000)).rejects.toThrow('INVALID_ID');
  });

  it('reserve_uploads raises INVALID_ITEMS for malformed items', async () => {
    const bad: unknown[] = [
      [1],
      ['x'],
      [null],
      [{}],
      [{ photo_id: 'not-a-uuid', bytes: 10 }],
      [{ photo_id: id(2), bytes: 'ten' }],
      [{ photo_id: id(2), bytes: 1.5 }],
      [{ photo_id: id(2), bytes: 0 }],
      [{ photo_id: id(2), bytes: -5 }],
      [{ photo_id: id(2) }],
      [{ photo_id: 7, bytes: 10 }],
      { photo_id: id(2), bytes: 10 },
      null,
    ];
    for (const items of bad) {
      await expect(reserve(items), JSON.stringify(items)).rejects.toThrow('INVALID_ITEMS');
    }
    expect((await db.query('select 1 from public.upload_reservations')).rows).toHaveLength(0);
  });

  it('reserve_uploads still accepts a well-formed batch', async () => {
    const r = (await reserve([{ photo_id: id(2), bytes: 1000 }])).rows[0].r;
    expect(r.results).toEqual([{ photo_id: id(2), ok: true }]);
  });

  it('reserve_uploads refuses an id that is already a registered photo', async () => {
    await register(id(3), variants(), 1_540_000);
    await expect(reserve([{ photo_id: id(3), bytes: 1000 }])).rejects.toThrow('CONFLICT');
    expect((await db.query('select 1 from public.upload_reservations')).rows).toHaveLength(0);
  });
});

describe('package.json test script', () => {
  it('does not force a reporter', () => {
    const pkg = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf8'),
    ) as { scripts: { test: string } };
    expect(pkg.scripts.test).not.toMatch(/reporter/);
  });
});
