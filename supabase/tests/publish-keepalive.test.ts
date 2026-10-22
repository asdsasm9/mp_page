import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asRole, createMigratedDb, seedAdmin } from './helpers/db';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

let db: PGlite;
const asAdmin = <T>(fn: (d: PGlite) => Promise<T>) => asRole(db, 'authenticated', fn, ADMIN);
const asOther = <T>(fn: (d: PGlite) => Promise<T>) => asRole(db, 'authenticated', fn, OTHER);
const asAnon = <T>(fn: (d: PGlite) => Promise<T>) => asRole(db, 'anon', fn);

const requestPublish = () =>
  asAdmin((d) => d.query<{ r: { log_id: string; pending_seen: number } }>('select public.request_publish() as r'));
const record = (logId: string, status: string, seen: number, err: string | null = null) =>
  asAdmin((d) =>
    d.query<{ r: { ok: boolean; pending_changes: number } }>(
      `select public.record_publish($1::uuid, $2, $3, 13, 141, 250000, $4) as r`,
      [logId, status, seen, err],
    ),
  );
const pending = async () =>
  (await db.query<{ n: number }>('select pending_changes as n from public.site_state')).rows[0].n;
/** Settable clock: pretend the last publish request happened `seconds` ago. */
const requestedAgo = (seconds: number | null) =>
  db.exec(
    seconds === null
      ? 'update public.site_state set last_publish_requested_at = null'
      : `update public.site_state set last_publish_requested_at = now() - interval '${seconds} seconds'`,
  );

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${OTHER}', 'o@example.test');
  `);
  await seedAdmin(db, ADMIN, 'a@example.test');
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec(`
    delete from public.publish_log;
    update public.site_state set pending_changes = 0, last_published_at = null, last_publish_requested_at = null;
    update public.keepalive set last_ping = null, pings = 0;
  `);
});

describe('request_publish', () => {
  it('returns the pending counter seen and writes a started log row', async () => {
    await db.exec('update public.site_state set pending_changes = 7');
    const r = (await requestPublish()).rows[0].r;
    expect(r.pending_seen).toBe(7);
    const log = await db.query<{ status: string; pending_seen: number; requested_by: string }>(
      `select status, pending_seen, requested_by from public.publish_log where id = '${r.log_id}'`,
    );
    expect(log.rows).toEqual([{ status: 'started', pending_seen: 7, requested_by: ADMIN }]);
  });

  it('a second request within 60 s raises PUBLISH_TOO_SOON with the seconds left', async () => {
    await requestPublish();
    await expect(requestPublish()).rejects.toMatchObject({ message: 'PUBLISH_TOO_SOON', detail: expect.stringMatching(/^\d+$/) });
    await requestedAgo(30);
    const e = await requestPublish().catch((x) => x);
    expect(e.message).toBe('PUBLISH_TOO_SOON');
    const left = Number(e.detail);
    expect(left).toBeGreaterThan(25);
    expect(left).toBeLessThanOrEqual(30);
  });

  it('is allowed again after 60 s', async () => {
    await requestPublish();
    await requestedAgo(61);
    await expect(requestPublish()).resolves.toBeDefined();
  });

  it('keeps the publish_log capped at 100 rows (newest survive)', async () => {
    await db.exec(`
      insert into public.publish_log (requested_at, status)
        select now() - make_interval(hours => g), 'ok' from generate_series(1, 105) g;
    `);
    const r = (await requestPublish()).rows[0].r;
    const n = await db.query<{ n: number }>('select count(*)::int as n from public.publish_log');
    expect(n.rows[0].n).toBe(100);
    const mine = await db.query(`select 1 from public.publish_log where id = '${r.log_id}'`);
    expect(mine.rows).toHaveLength(1);
  });
});

describe('record_publish', () => {
  it('on ok subtracts only what was seen and leaves the remainder', async () => {
    await db.exec('update public.site_state set pending_changes = 5');
    const { log_id, pending_seen } = (await requestPublish()).rows[0].r;
    await db.exec('update public.site_state set pending_changes = pending_changes + 2'); // edits during the build
    const out = (await record(log_id, 'ok', pending_seen)).rows[0].r;
    expect(out).toEqual({ ok: true, pending_changes: 2 });
    const s = await db.query<{ published: boolean }>('select last_published_at is not null as published from public.site_state');
    expect(s.rows[0].published).toBe(true);
    const log = await db.query<{ status: string; finished: boolean; a: number; p: number; b: string }>(
      `select status, finished_at is not null as finished, album_count as a, photo_count as p, snapshot_bytes::text as b
         from public.publish_log where id = '${log_id}'`,
    );
    expect(log.rows).toEqual([{ status: 'ok', finished: true, a: 13, p: 141, b: '250000' }]);
  });

  it('never goes below zero', async () => {
    await db.exec('update public.site_state set pending_changes = 1');
    const { log_id } = (await requestPublish()).rows[0].r;
    expect((await record(log_id, 'ok', 50)).rows[0].r.pending_changes).toBe(0);
  });

  it('a failed publish leaves the counter and last_published_at alone', async () => {
    await db.exec('update public.site_state set pending_changes = 4');
    const { log_id, pending_seen } = (await requestPublish()).rows[0].r;
    expect((await record(log_id, 'failed', pending_seen, 'build hook failed')).rows[0].r.pending_changes).toBe(4);
    const s = await db.query<{ published: boolean }>('select last_published_at is not null as published from public.site_state');
    expect(s.rows[0].published).toBe(false);
    const log = await db.query<{ status: string; error: string }>(
      `select status, error from public.publish_log where id = '${log_id}'`,
    );
    expect(log.rows).toEqual([{ status: 'failed', error: 'build hook failed' }]);
  });

  it('rejects an unknown status, an unknown or already finished log row', async () => {
    const { log_id } = (await requestPublish()).rows[0].r;
    await expect(record(log_id, 'started', 0)).rejects.toThrow('INVALID_STATUS');
    await expect(record('99999999-0000-4000-8000-000000000000', 'ok', 0)).rejects.toThrow('CONFLICT');
    await record(log_id, 'ok', 0);
    await expect(record(log_id, 'ok', 0)).rejects.toThrow('CONFLICT');
  });
});

describe('publish: access', () => {
  const calls = [
    `select public.request_publish()`,
    `select public.record_publish('99999999-0000-4000-8000-000000000000'::uuid, 'ok', 0, 0, 0, 0::bigint, null)`,
  ];
  for (const sql of calls) {
    it(`anon is refused: ${sql}`, async () => {
      await expect(asAnon((d) => d.query(sql))).rejects.toMatchObject({ code: '42501' });
    });
    it(`a non-admin is refused with NOT_ADMIN: ${sql}`, async () => {
      await expect(asOther((d) => d.query(sql))).rejects.toThrow('NOT_ADMIN');
      await expect(asOther((d) => d.query(sql))).rejects.toMatchObject({ code: '42501' });
    });
  }
});

describe('keepalive', () => {
  const ping = () => asAnon((d) => d.query<{ r: unknown }>('select public.keepalive() as r'));
  const row = async () =>
    (await db.query<{ pings: string; last_ping: string | null }>('select pings::text, last_ping::text from public.keepalive')).rows[0];

  it('anon gets {ok:true} and nothing else', async () => {
    expect((await ping()).rows[0].r).toEqual({ ok: true });
    expect((await row()).pings).toBe('1');
  });

  it('twice within a minute changes the row only once', async () => {
    await ping();
    const first = await row();
    await ping();
    expect(await row()).toEqual(first);
  });

  it('pings again after a minute', async () => {
    await ping();
    await db.exec(`update public.keepalive set last_ping = now() - interval '61 seconds'`);
    await ping();
    expect((await row()).pings).toBe('2');
  });

  it('authenticated may call it too', async () => {
    await expect(asOther((d) => d.query('select public.keepalive()'))).resolves.toBeDefined();
  });

  it('anon still cannot read or write the keepalive table', async () => {
    await expect(asAnon((d) => d.query('select * from public.keepalive'))).rejects.toThrow(/permission denied/);
    await expect(asAnon((d) => d.query('update public.keepalive set pings = 99'))).rejects.toThrow(/permission denied/);
  });
});
