import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_COLUMNS } from '../../packages/shared/src/db';
import { DEFAULT_LIMITS } from '../../packages/shared/src/limits';
import { asRole, createMigratedDb, seedAdmin } from './helpers/db';
import { tablePrivilegeMatrix } from './helpers/privileges';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

let db: PGlite;

const asAdmin = <T>(fn: (d: PGlite) => Promise<T>) => asRole(db, 'authenticated', fn, ADMIN);
const asOther = <T>(fn: (d: PGlite) => Promise<T>) => asRole(db, 'authenticated', fn, OTHER);
const asAnon = <T>(fn: (d: PGlite) => Promise<T>) => asRole(db, 'anon', fn);

const READABLE = ['app_config', 'site_state', 'publish_log', 'upload_reservations'] as const;
const ALL = [...READABLE, 'keepalive'] as const;

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN}', 'a@example.test'), ('${OTHER}', 'o@example.test');
    insert into public.publish_log (requested_by, status) values ('${ADMIN}', 'ok');
    insert into public.upload_reservations (photo_id, requested_by, bytes, expires_at)
      values ('dddddddd-0000-4000-8000-000000000001', '${ADMIN}', 1000, now() + interval '1 hour');
  `);
  await seedAdmin(db, ADMIN, 'a@example.test');
});

afterAll(async () => {
  await db.close();
});

describe('migration C: seeded single rows', () => {
  it('app_config defaults equal DEFAULT_LIMITS', async () => {
    const r = await db.query<Record<string, string | number>>('select * from public.app_config');
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0];
    expect({
      quotaHardBytes: Number(row.quota_hard_bytes),
      quotaWarnBytes: Number(row.quota_warn_bytes),
      maxUploadBytes: Number(row.max_upload_bytes),
      maxFilesPerBatch: Number(row.max_files_per_batch),
      reservationTtlMin: Number(row.reservation_ttl_min),
    }).toEqual(DEFAULT_LIMITS);
  });

  it('site_state and keepalive start as one zeroed row', async () => {
    const s = await db.query<{ pending_changes: number; last_published_at: string | null }>('select * from public.site_state');
    expect(s.rows).toEqual([expect.objectContaining({ pending_changes: 0, last_published_at: null })]);
    const k = await db.query<{ pings: string | number; last_ping: string | null }>('select * from public.keepalive');
    expect(k.rows).toHaveLength(1);
    expect(Number(k.rows[0].pings)).toBe(0);
    expect(k.rows[0].last_ping).toBeNull();
  });

  for (const t of ['app_config', 'site_state', 'keepalive']) {
    it(`${t}: a second row is refused`, async () => {
      await expect(db.query(`insert into public.${t} default values`)).rejects.toThrow(/duplicate key|unique/);
      await expect(db.query(`insert into public.${t} (id) values (false)`)).rejects.toThrow(/_single_row/);
    });
  }
});

describe('migration C: constraints', () => {
  const setCfg = (set: string) => db.query(`update public.app_config set ${set}`);

  it('refuses warn > hard', async () => {
    await expect(setCfg('quota_warn_bytes = quota_hard_bytes + 1')).rejects.toThrow(/app_config_quota_order/);
  });
  it('refuses hard > 1e10', async () => {
    await expect(setCfg('quota_hard_bytes = 10000000001')).rejects.toThrow(/app_config_quota_order/);
  });
  it('refuses warn <= 0', async () => {
    await expect(setCfg('quota_warn_bytes = 0')).rejects.toThrow(/app_config_quota_order/);
  });
  it('allows warn = hard = 1e10 and then restores the defaults', async () => {
    await setCfg('quota_hard_bytes = 10000000000, quota_warn_bytes = 10000000000');
    await setCfg('quota_hard_bytes = 9500000000, quota_warn_bytes = 8000000000');
  });
  it('refuses non-positive limits', async () => {
    await expect(setCfg('max_upload_bytes = 0')).rejects.toThrow(/app_config_max_upload_positive/);
    await expect(setCfg('max_files_per_batch = 0')).rejects.toThrow(/app_config_batch_positive/);
    await expect(setCfg('reservation_ttl_min = 0')).rejects.toThrow(/app_config_ttl_positive/);
  });
  it('site_state.pending_changes cannot go negative', async () => {
    await expect(db.query('update public.site_state set pending_changes = -1')).rejects.toThrow(/site_state_pending_nonneg/);
  });
  it('publish_log status is limited', async () => {
    await expect(db.query(`insert into public.publish_log (status) values ('weird')`)).rejects.toThrow(/publish_log_status/);
  });
  it('upload_reservations bytes must be positive', async () => {
    await expect(
      db.query(`insert into public.upload_reservations (photo_id, bytes, expires_at) values (gen_random_uuid(), 0, now())`),
    ).rejects.toThrow(/upload_reservations_bytes_positive/);
  });
});

describe('migration C: access', () => {
  for (const t of ALL) {
    it(`${t}: anon is denied`, async () => {
      await expect(asAnon((d) => d.query(`select * from public.${t}`))).rejects.toThrow(/permission denied/);
    });
  }

  for (const t of READABLE) {
    it(`${t}: an admin can select but not write`, async () => {
      const r = await asAdmin((d) => d.query(`select * from public.${t}`));
      expect(r.rows).toHaveLength(1);
      await expect(asAdmin((d) => d.query(`insert into public.${t} default values`))).rejects.toThrow(/permission denied/);
      await expect(asAdmin((d) => d.query(`update public.${t} set ${DB_COLUMNS[t][0]} = ${DB_COLUMNS[t][0]}`))).rejects.toThrow(/permission denied/);
      await expect(asAdmin((d) => d.query(`delete from public.${t}`))).rejects.toThrow(/permission denied/);
    });

    it(`${t}: a non-admin sees nothing`, async () => {
      const r = await asOther((d) => d.query(`select * from public.${t}`));
      expect(r.rows).toEqual([]);
    });
  }

  it('keepalive: no API role has any privilege, even an admin', async () => {
    await expect(asAdmin((d) => d.query('select * from public.keepalive'))).rejects.toThrow(/permission denied/);
    await expect(asAdmin((d) => d.query('update public.keepalive set pings = 99'))).rejects.toThrow(/permission denied/);
  });

  it('privilege matrix is exactly as designed', async () => {
    const m = await tablePrivilegeMatrix(db);
    const none = { select: 'none', insert: 'none', update: 'none', delete: 'none' };
    for (const t of ALL) expect(m[t].anon).toEqual(none);
    for (const t of READABLE) expect(m[t].authenticated).toEqual({ ...none, select: 'table' });
    expect(m.keepalive.authenticated).toEqual(none);
  });

  for (const t of ALL) {
    it(`${t} columns equal DB_COLUMNS`, async () => {
      const r = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`,
        [t],
      );
      expect(r.rows.map((x) => x.column_name)).toEqual([...DB_COLUMNS[t]]);
    });
  }
});
