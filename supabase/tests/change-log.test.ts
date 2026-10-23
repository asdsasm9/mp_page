import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CHANGE_SCENARIOS, type ScenarioOp } from '../../packages/shared/src/change-log-scenarios';
import { asRole, createMigratedDb, seedAdmin } from './helpers/db';
import { functionPrivilegeMatrix, lintPublicSchema } from './helpers/privileges';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const CAT = 'aaaaaaaa-0000-4000-8000-000000000001';
const CAT2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const ALB1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const ALB2 = 'bbbbbbbb-0000-4000-8000-000000000002';
const P1 = 'cccccccc-0000-4000-8000-000000000001';
const P2 = 'cccccccc-0000-4000-8000-000000000002';

let db: PGlite;
const asAdmin = <T>(fn: (d: PGlite) => Promise<T>) => asRole(db, 'authenticated', fn, ADMIN);

const photo = (id: string, alb: string, extra = '') =>
  `insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total, alt)
   values ('${id}', '${alb}', 'photos/${id}/master.jpg', 1, 1, '{}', 0, ${extra || 'null'})`;

interface Line {
  table_name: string;
  row_id: string;
  kind: string;
  label: string;
  category_name: string | null;
  album_title: string | null;
}
const lines = async () =>
  (
    await db.query<Line>(
      `select table_name, row_id, kind, label, category_name, album_title from public.change_log order by id`,
    )
  ).rows;
const kinds = async () => (await lines()).map((l) => `${l.table_name}:${l.kind}`);

/** Publish baseline: catalog exists and has been published (log empty). */
beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id, email) values ('${OTHER}', 'o@example.test')`);
  await seedAdmin(db, ADMIN, 'a@example.test');
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec(`
    delete from public.photos;
    update public.albums set cover_photo_id = null;
    delete from public.albums;
    delete from public.categories;
    delete from public.url_history;
    delete from public.change_log;
    delete from public.publish_log;
    update public.site_state set pending_changes = 0, last_published_at = null, last_publish_requested_at = null;
    insert into public.categories (id, slug, name) values ('${CAT}', 'svatby', 'Svatby'), ('${CAT2}', 'portrety', 'Portréty');
    insert into public.albums (id, category_id, slug, title) values
      ('${ALB1}', '${CAT}', 'one', 'První'), ('${ALB2}', '${CAT2}', 'two', 'Druhé');
    ${photo(P1, ALB1, `'Nevěsta'`)};
    delete from public.change_log;
  `);
});

/** SQL ids for the symbolic refs of the shared scenarios (packages/shared/src/change-log-scenarios.ts). */
const IDS: Record<string, string> = { svatby: CAT, portrety: CAT2, one: ALB1, two: ALB2, P1, P2 };
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

function sqlFor(o: ScenarioOp): string {
  switch (o.op) {
    case 'addCategory':
      return `insert into public.categories (slug, name) values (${q(o.ref)}, ${q(o.name)}) returning id`;
    case 'addAlbum':
      return `insert into public.albums (category_id, slug, title) values ('${IDS[o.category]}', ${q(o.ref)}, ${q(o.title)}) returning id`;
    case 'addPhoto':
      return photo(IDS[o.ref]!, IDS[o.album]!, o.alt === undefined ? '' : q(o.alt));
    case 'setCategory':
      return `update public.categories set name = ${q(o.set.name)} where id = '${IDS[o.ref]}'`;
    case 'setAlbum': {
      const set: string[] = [];
      if (o.set.title !== undefined) set.push(`title = ${q(o.set.title)}`);
      if (o.set.sort !== undefined) set.push(`sort = ${o.set.sort}`);
      if (o.set.slug !== undefined) set.push(`slug = ${q(o.set.slug)}`);
      if (o.set.cover !== undefined) set.push(`cover_photo_id = ${o.set.cover === null ? 'null' : `'${IDS[o.set.cover]}'`}`);
      return `update public.albums set ${set.join(', ')} where id = '${IDS[o.ref]}'`;
    }
    case 'setPhoto': {
      const set: string[] = [];
      if (o.set.alt !== undefined) set.push(`alt = ${q(o.set.alt)}`);
      if (o.set.caption !== undefined) set.push(`caption = ${q(o.set.caption)}`);
      if (o.set.sort !== undefined) set.push(`sort = ${o.set.sort}`);
      if (o.set.album !== undefined) set.push(`album_id = '${IDS[o.set.album]}'`);
      return `update public.photos set ${set.join(', ')} where id = '${IDS[o.ref]}'`;
    }
    case 'deletePhoto':
      return `delete from public.photos where id = '${IDS[o.ref]}'`;
  }
}

describe('log_change: shared scenarios (same table drives the fake in the admin app)', () => {
  it.each(CHANGE_SCENARIOS.map((s) => [s.name, s] as const))('%s', async (_name, scenario) => {
    for (const o of scenario.ops) {
      const res = await db.query<{ id: string }>(sqlFor(o));
      // Rows created without a known id get one from the database; later ops may refer to them by ref.
      if ((o.op === 'addCategory' || o.op === 'addAlbum') && res.rows[0]) IDS[o.ref] = res.rows[0].id;
    }
    const l = await lines();
    expect(l.map((x) => [x.table_name, x.kind, x.label, x.category_name, x.album_title])).toEqual(
      scenario.lines.map((x) => [...x]),
    );
  });
});

describe('log_change: SQL only', () => {
  it('url_history writes are not logged', async () => {
    await db.exec(`insert into public.url_history (old_path, status) values ('/x/', 301)`);
    await db.exec(`update public.url_history set status = 410 where old_path = '/x/'`);
    expect(await lines()).toEqual([]);
  });

  it('a slug change also writes url_history but is one line', async () => {
    await db.exec(`update public.albums set slug = 'one-new' where id = '${ALB1}'`);
    expect((await db.query('select 1 from public.url_history')).rows.length).toBeGreaterThan(0);
    expect(await kinds()).toEqual(['albums:edited']);
  });

  it('repeated edits refresh the time of the same line', async () => {
    await db.exec(`update public.albums set title = 'A' where id = '${ALB1}'`);
    const first = (await db.query<{ at: string }>('select at::text as at from public.change_log')).rows[0]!.at;
    await db.exec('select pg_sleep(0.02)');
    await db.exec(`update public.albums set title = 'B' where id = '${ALB1}'`);
    const r = await db.query<{ label: string; later: boolean }>(
      `select label, at > '${first}'::timestamptz as later from public.change_log`,
    );
    expect(r.rows).toEqual([{ label: 'B', later: true }]);
  });
});

describe('change_log: panel count equals the lines', () => {
  it('count(*) is the number of lines', async () => {
    await db.exec(`
      update public.albums set title = 'a' where id = '${ALB1}';
      update public.albums set title = 'b' where id = '${ALB1}';
      update public.categories set name = 'S' where id = '${CAT}';
      ${photo(P2, ALB2)};
    `);
    const n = (await db.query<{ n: number }>('select count(*)::int as n from public.change_log')).rows[0]!.n;
    expect(n).toBe(3);
    expect((await lines()).length).toBe(n);
  });
});

describe('change_log: privileges and RLS', () => {
  it('an admin reads the lines', async () => {
    await db.exec(`update public.albums set title = 'a' where id = '${ALB1}'`);
    const r = await asAdmin((d) => d.query('select * from public.change_log'));
    expect(r.rows.length).toBe(1);
  });

  it('a signed-in user who is not an admin sees nothing', async () => {
    await db.exec(`update public.albums set title = 'a' where id = '${ALB1}'`);
    const r = await asRole(db, 'authenticated', (d) => d.query('select * from public.change_log'), OTHER);
    expect(r.rows).toEqual([]);
  });

  it('anon cannot read', async () => {
    await expect(asRole(db, 'anon', (d) => d.query('select * from public.change_log'))).rejects.toThrow(/permission denied/);
  });

  it('no API role can insert, update or delete, not even an admin', async () => {
    await db.exec(`update public.albums set title = 'a' where id = '${ALB1}'`);
    for (const sql of [
      `insert into public.change_log (table_name, row_id, kind) values ('albums', gen_random_uuid(), 'added')`,
      `update public.change_log set kind = 'deleted'`,
      `delete from public.change_log`,
    ]) {
      await expect(asAdmin((d) => d.query(sql)), sql).rejects.toThrow(/permission denied/);
      await expect(asRole(db, 'anon', (d) => d.query(sql)), sql).rejects.toThrow(/permission denied/);
    }
    expect((await lines()).length).toBe(1);
  });

  it('the trigger function is not callable through the API and the schema lint is clean', async () => {
    const m = await functionPrivilegeMatrix(db);
    expect(m.log_change).toEqual({ anon: false, authenticated: false });
    await expect(asAdmin((d) => d.query('select public.log_change()'))).rejects.toThrow(/permission denied for function log_change/);
    expect(await lintPublicSchema(db)).toEqual([]);
  });

  it('an admin editing through the API role is logged (definer rights)', async () => {
    await asAdmin((d) => d.query(`update public.photos set alt = 'API' where id = '${P1}'`));
    expect(await kinds()).toEqual(['photos:edited']);
  });
});

describe('change_log: cleared by publish', () => {
  const requestPublish = () =>
    asAdmin((d) => d.query<{ r: { log_id: string; pending_seen: number } }>('select public.request_publish() as r'));
  const record = (logId: string, status: string) =>
    asAdmin((d) => d.query(`select public.record_publish($1::uuid, $2, 0, 1, 1, 1, null)`, [logId, status]));

  it('a successful publish clears what was listed at the request', async () => {
    await db.exec(`update public.albums set title = 'a' where id = '${ALB1}'; ${photo(P2, ALB2)}`);
    const { log_id } = (await requestPublish()).rows[0]!.r;
    await record(log_id, 'ok');
    expect(await lines()).toEqual([]);
  });

  it('edits made while the build runs stay listed', async () => {
    await db.exec(`update public.albums set title = 'a' where id = '${ALB1}'`);
    const { log_id } = (await requestPublish()).rows[0]!.r;
    await db.exec('select pg_sleep(0.02)');
    await db.exec(`update public.categories set name = 'During' where id = '${CAT}'`);
    await record(log_id, 'ok');
    expect(await kinds()).toEqual(['categories:edited']);
  });

  it('a failed publish clears nothing', async () => {
    await db.exec(`update public.albums set title = 'a' where id = '${ALB1}'`);
    const { log_id } = (await requestPublish()).rows[0]!.r;
    await record(log_id, 'failed');
    expect(await kinds()).toEqual(['albums:edited']);
  });

  it('a row changed again after the publish is a new line', async () => {
    await db.exec(`update public.albums set title = 'a' where id = '${ALB1}'`);
    const { log_id } = (await requestPublish()).rows[0]!.r;
    await record(log_id, 'ok');
    await db.exec(`update public.albums set title = 'b' where id = '${ALB1}'`);
    expect((await lines()).map((x) => [x.kind, x.label])).toEqual([['edited', 'b']]);
  });
});
