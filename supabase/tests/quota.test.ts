import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BatchTooLargeError, planBatch, type BatchItem } from '../../packages/shared/src/quota';
import { asRole, createMigratedDb } from './helpers/db';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const CAT = 'aaaaaaaa-0000-4000-8000-000000000001';
const ALB = 'bbbbbbbb-0000-4000-8000-000000000001';
const USED_PHOTO = 'cccccccc-0000-4000-8000-000000000001';
const RES = 'dddddddd-0000-4000-8000-000000000001';

const id = (n: number) => `eeeeeeee-0000-4000-8000-${String(n).padStart(12, '0')}`;

let db: PGlite;

const asAdmin = <T>(fn: (d: PGlite) => Promise<T>) => asRole(db, 'authenticated', fn, ADMIN);

interface Config {
  hard: number;
  warn: number;
  maxUpload: number;
  maxFiles: number;
}
const DEFAULTS: Config = { hard: 9_500_000_000, warn: 8_000_000_000, maxUpload: 41_943_040, maxFiles: 200 };

/** Puts the database into a known state: one photo of `used` bytes, one live reservation of `reserved`. */
async function setState(used: number, reserved: number, cfg: Partial<Config> = {}) {
  const c = { ...DEFAULTS, ...cfg };
  await db.exec(`
    delete from public.upload_reservations;
    delete from public.photos;
    update public.app_config set
      quota_hard_bytes = ${c.hard}, quota_warn_bytes = ${c.warn},
      max_upload_bytes = ${c.maxUpload}, max_files_per_batch = ${c.maxFiles};
  `);
  if (used > 0) {
    await db.exec(
      `insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total)
       values ('${USED_PHOTO}', '${ALB}', 'photos/${USED_PHOTO}/master.jpg', 1, 1, '{}', ${used})`,
    );
  }
  if (reserved > 0) {
    await db.exec(
      `insert into public.upload_reservations (photo_id, bytes, expires_at)
       values ('${RES}', ${reserved}, now() + interval '1 hour')`,
    );
  }
}

const reserve = (items: BatchItem[]) =>
  asAdmin((d) => d.query<{ r: unknown }>('select public.reserve_uploads($1::jsonb) as r', [JSON.stringify(items)]));

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN}', 'a@example.test'), ('${OTHER}', 'o@example.test');
    insert into public.admins (user_id) values ('${ADMIN}');
    insert into public.categories (id, slug, name) values ('${CAT}', 'svatby', 'Svatby');
    insert into public.albums (id, category_id, slug, title) values ('${ALB}', '${CAT}', 'one', 'One');
  `);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await setState(0, 0);
});

interface Case {
  name: string;
  used: number;
  reserved: number;
  cfg?: Partial<Config>;
  items: Array<[number, number]>; // [n, bytes]
  /** Expected codes in order ('ok' or a code), asserted on both implementations. */
  expect: string[];
}

const CASES: Case[] = [
  { name: 'empty batch', used: 0, reserved: 0, items: [], expect: [] },
  { name: 'single small item', used: 0, reserved: 0, items: [[1, 1000]], expect: ['ok'] },
  {
    name: 'exactly at the hard limit is accepted',
    used: 9_500_000_000 - 1000,
    reserved: 0,
    items: [[1, 1000]],
    expect: ['ok'],
  },
  {
    name: 'one byte over the hard limit is STORAGE_FULL',
    used: 9_500_000_000 - 1000,
    reserved: 0,
    items: [[1, 1001]],
    expect: ['STORAGE_FULL'],
  },
  {
    name: 'existing reservations count against the limit',
    used: 1000,
    reserved: 1000,
    cfg: { hard: 3000, warn: 2000 },
    items: [[1, 1001], [2, 1000]],
    expect: ['STORAGE_FULL', 'ok'],
  },
  {
    name: 'two reservations that together exceed the limit: first accepted, second refused',
    used: 0,
    reserved: 0,
    cfg: { hard: 3000, warn: 2000 },
    items: [[1, 2000], [2, 2000]],
    expect: ['ok', 'STORAGE_FULL'],
  },
  {
    name: 'first-fit: a refused big item does not block a later small one',
    used: 0,
    reserved: 0,
    cfg: { hard: 3000, warn: 2000 },
    items: [[1, 2000], [2, 2000], [3, 1000]],
    expect: ['ok', 'STORAGE_FULL', 'ok'],
  },
  {
    name: 'file at max upload is accepted, one byte more is FILE_TOO_LARGE',
    used: 0,
    reserved: 0,
    items: [[1, 41_943_040], [2, 41_943_041]],
    expect: ['ok', 'FILE_TOO_LARGE'],
  },
  {
    name: 'FILE_TOO_LARGE wins over STORAGE_FULL',
    used: 0,
    reserved: 0,
    cfg: { hard: 1000, warn: 500 },
    items: [[1, 41_943_041]],
    expect: ['FILE_TOO_LARGE'],
  },
  {
    name: 'refused items consume nothing',
    used: 0,
    reserved: 0,
    cfg: { hard: 1500, warn: 1000, maxUpload: 1200 },
    items: [[1, 1300], [2, 1200], [3, 300]],
    expect: ['FILE_TOO_LARGE', 'ok', 'ok'],
  },
  {
    name: 'warn level reached by the batch',
    used: 7_999_000_000,
    reserved: 0,
    items: [[1, 2_000_000]],
    expect: ['ok'],
  },
];

describe('reserve_uploads versus planBatch (parity)', () => {
  for (const c of CASES) {
    it(c.name, async () => {
      await setState(c.used, c.reserved, c.cfg);
      const items = c.items.map(([n, bytes]) => ({ photo_id: id(n), bytes }));

      const plan = planBatch(
        {
          used: c.used,
          reserved: c.reserved,
          hard: c.cfg?.hard ?? DEFAULTS.hard,
          warn: c.cfg?.warn ?? DEFAULTS.warn,
          maxUploadBytes: c.cfg?.maxUpload ?? DEFAULTS.maxUpload,
          maxFilesPerBatch: c.cfg?.maxFiles ?? DEFAULTS.maxFiles,
        },
        items,
      );
      const sql = (await reserve(items)).rows[0].r;

      expect(sql).toEqual(plan);
      expect(plan.results.map((r) => (r.ok ? 'ok' : r.code))).toEqual(c.expect);
    });
  }

  it('BATCH_TOO_LARGE: both implementations refuse more than max_files_per_batch', async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ photo_id: id(i + 1), bytes: 10 }));
    expect(() => planBatch({ used: 0, reserved: 0, hard: DEFAULTS.hard, warn: DEFAULTS.warn }, items)).toThrow(
      BatchTooLargeError,
    );
    await expect(reserve(items)).rejects.toThrow('BATCH_TOO_LARGE');
    const n = await db.query<{ n: number }>('select count(*)::int as n from public.upload_reservations');
    expect(n.rows[0].n).toBe(0);
  });

  it('exactly max_files_per_batch items are accepted', async () => {
    await setState(0, 0, { maxFiles: 3 });
    const items = [1, 2, 3].map((n) => ({ photo_id: id(n), bytes: 10 }));
    const sql = (await reserve(items)).rows[0].r as { results: Array<{ ok: boolean }> };
    expect(sql.results.every((r) => r.ok)).toBe(true);
  });
});

describe('reserve_uploads: persistence and expiry', () => {
  it('stores accepted reservations with an expiry of reservation_ttl_min', async () => {
    await reserve([{ photo_id: id(1), bytes: 500 }]);
    const r = await db.query<{ bytes: string; mins: number }>(
      `select bytes::text, round(extract(epoch from (expires_at - now())) / 60)::int as mins
         from public.upload_reservations where photo_id = '${id(1)}'`,
    );
    expect(r.rows).toEqual([{ bytes: '500', mins: 60 }]);
  });

  it('refused items leave no reservation row', async () => {
    await setState(0, 0, { hard: 1000, warn: 500 });
    await reserve([{ photo_id: id(1), bytes: 5000 }]);
    const n = await db.query<{ n: number }>('select count(*)::int as n from public.upload_reservations');
    expect(n.rows[0].n).toBe(0);
  });

  it('expired reservations stop counting and are cleaned up', async () => {
    await setState(0, 0, { hard: 3000, warn: 2000 });
    await db.exec(
      `insert into public.upload_reservations (photo_id, bytes, expires_at)
       values ('${RES}', 2500, now() - interval '1 minute')`,
    );
    const usage = (await asAdmin((d) => d.query<{ u: { reserved_bytes: number } }>('select public.storage_usage() as u'))).rows[0].u;
    expect(usage.reserved_bytes).toBe(0);

    const out = (await reserve([{ photo_id: id(1), bytes: 2800 }])).rows[0].r as { results: Array<{ ok: boolean }> };
    expect(out.results[0].ok).toBe(true);
    const old = await db.query(`select 1 from public.upload_reservations where photo_id = '${RES}'`);
    expect(old.rows).toHaveLength(0);
  });

  it('re-reserving the same photo replaces its reservation instead of double counting', async () => {
    await setState(0, 0, { hard: 3000, warn: 2000 });
    await reserve([{ photo_id: id(1), bytes: 2000 }]);
    const out = (await reserve([{ photo_id: id(1), bytes: 2500 }])).rows[0].r as { reserved_bytes: number; results: Array<{ ok: boolean }> };
    expect(out.results[0].ok).toBe(true);
    expect(out.reserved_bytes).toBe(2500);
  });

  it('rejects malformed items', async () => {
    await expect(asAdmin((d) => d.query(`select public.reserve_uploads('{"a":1}'::jsonb)`))).rejects.toThrow('INVALID_ITEMS');
    await expect(reserve([{ photo_id: id(1), bytes: 0 }])).rejects.toThrow('INVALID_ITEMS');
  });
});

describe('storage_usage', () => {
  it('reports used, reserved, limits, photo count and level', async () => {
    await setState(7_000_000_000, 1_000_000_000);
    const u = (await asAdmin((d) => d.query<{ u: unknown }>('select public.storage_usage() as u'))).rows[0].u;
    expect(u).toEqual({
      used_bytes: 7_000_000_000,
      reserved_bytes: 1_000_000_000,
      hard: 9_500_000_000,
      warn: 8_000_000_000,
      photo_count: 1,
      level: 'warn',
    });
  });

  it('level is ok below warn and full at hard', async () => {
    const level = async () =>
      ((await asAdmin((d) => d.query<{ u: { level: string } }>('select public.storage_usage() as u'))).rows[0].u).level;
    await setState(7_999_999_999, 0);
    expect(await level()).toBe('ok');
    await setState(9_500_000_000, 0);
    expect(await level()).toBe('full');
  });

  it('deleting photos lowers usage and lets the upload through again', async () => {
    await setState(9_500_000_000, 0);
    const first = (await reserve([{ photo_id: id(1), bytes: 1000 }])).rows[0].r as { results: Array<{ code?: string }> };
    expect(first.results[0].code).toBe('STORAGE_FULL');
    await db.exec(`delete from public.photos`);
    const second = (await reserve([{ photo_id: id(1), bytes: 1000 }])).rows[0].r as { results: Array<{ ok: boolean }> };
    expect(second.results[0].ok).toBe(true);
  });
});

describe('quota functions: access', () => {
  const calls = [
    `select public.storage_usage()`,
    `select public.reserve_uploads('[]'::jsonb)`,
  ];

  for (const sql of calls) {
    it(`anon is refused: ${sql}`, async () => {
      await expect(asRole(db, 'anon', (d) => d.query(sql))).rejects.toMatchObject({ code: '42501' });
    });
    it(`a non-admin is refused with NOT_ADMIN (42501): ${sql}`, async () => {
      const p = asRole(db, 'authenticated', (d) => d.query(sql), OTHER);
      await expect(p).rejects.toThrow('NOT_ADMIN');
      await expect(asRole(db, 'authenticated', (d) => d.query(sql), OTHER)).rejects.toMatchObject({ code: '42501' });
    });
    it(`an admin is allowed: ${sql}`, async () => {
      await expect(asAdmin((d) => d.query(sql))).resolves.toBeDefined();
    });
  }

  it('reserve_uploads locks the site_state row and sets an empty search_path', async () => {
    const r = await db.query<{ prosrc: string; secdef: boolean; config: string[] }>(
      `select prosrc, prosecdef as secdef, proconfig as config from pg_proc where proname = 'reserve_uploads'`,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].prosrc).toMatch(/from public\.site_state for update/i);
    expect(r.rows[0].secdef).toBe(true);
    expect(r.rows[0].config).toContain('search_path=""');
  });
});
