import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

describe('log_change: kinds', () => {
  it('logs inserts as added with name and grouping context', async () => {
    await db.exec(photo(P2, ALB2, `'Pár na louce'`));
    await db.exec(`insert into public.albums (category_id, slug, title) values ('${CAT}', 'three', 'Třetí')`);
    await db.exec(`insert into public.categories (slug, name) values ('rodina', 'Rodina')`);
    const l = await lines();
    expect(l.map((x) => [x.table_name, x.kind, x.label, x.category_name, x.album_title])).toEqual([
      ['photos', 'added', 'Pár na louce', 'Portréty', 'Druhé'],
      ['albums', 'added', 'Třetí', 'Svatby', 'Třetí'],
      ['categories', 'added', 'Rodina', 'Rodina', null],
    ]);
  });

  it('a photo without alt text or caption gets an empty label, caption is the fallback', async () => {
    await db.exec(photo(P2, ALB1));
    expect((await lines())[0]!.label).toBe('');
    await db.exec(`update public.photos set caption = 'Podpis' where id = '${P2}'`);
    expect((await lines())[0]!.label).toBe('Podpis');
  });

  it('an update of only sort is reordered, any other column makes it edited', async () => {
    await db.exec(`update public.albums set sort = 5 where id = '${ALB1}'`);
    expect(await kinds()).toEqual(['albums:reordered']);
    await db.exec(`update public.photos set sort = 5 where id = '${P1}'`);
    expect(await kinds()).toEqual(['albums:reordered', 'photos:reordered']);
    await db.exec(`update public.albums set title = 'První nově', sort = 6 where id = '${ALB1}'`);
    expect(await kinds()).toEqual(['albums:edited', 'photos:reordered']);
    expect((await lines())[0]!.label).toBe('První nově');
  });

  it('an update that changes no value but updated_at is not logged', async () => {
    await db.exec(`update public.albums set title = title, sort = sort where id = '${ALB1}'`);
    await db.exec(`update public.photos set alt = alt where id = '${P1}'`);
    expect(await lines()).toEqual([]);
  });

  it('moving a photo to another album is edited and carries the new album', async () => {
    await db.exec(`update public.photos set album_id = '${ALB2}' where id = '${P1}'`);
    const l = await lines();
    expect(l.map((x) => [x.kind, x.album_title, x.category_name])).toEqual([['edited', 'Druhé', 'Portréty']]);
  });

  it('deleting a published row is deleted, with the name at change time', async () => {
    await db.exec(`delete from public.photos where id = '${P1}'`);
    expect((await lines()).map((x) => [x.kind, x.label, x.album_title])).toEqual([['deleted', 'Nevěsta', 'První']]);
  });

  it('url_history writes are not logged', async () => {
    await db.exec(`insert into public.url_history (old_path, status) values ('/x/', 301)`);
    await db.exec(`update public.url_history set status = 410 where old_path = '/x/'`);
    expect(await lines()).toEqual([]);
  });

  it('a slug change is one edited album line although it also writes url_history', async () => {
    await db.exec(`update public.albums set slug = 'one-new' where id = '${ALB1}'`);
    expect(await kinds()).toEqual(['albums:edited']);
  });
});

describe('log_change: one line per row', () => {
  it('repeated edits refresh the same line (time and label) instead of adding lines', async () => {
    await db.exec(`update public.albums set title = 'A' where id = '${ALB1}'`);
    const first = (await db.query<{ at: string }>('select at::text as at from public.change_log')).rows[0]!.at;
    await db.exec('select pg_sleep(0.02)');
    await db.exec(`update public.albums set title = 'B' where id = '${ALB1}'`);
    const r = await db.query<{ label: string; later: boolean }>(
      `select label, at > '${first}'::timestamptz as later from public.change_log`,
    );
    expect(r.rows).toEqual([{ label: 'B', later: true }]);
  });

  it('added stays added when edited or reordered afterwards', async () => {
    await db.exec(photo(P2, ALB1));
    await db.exec(`update public.photos set alt = 'x' where id = '${P2}'`);
    await db.exec(`update public.photos set sort = 3 where id = '${P2}'`);
    expect(await kinds()).toEqual(['photos:added']);
    expect((await lines())[0]!.label).toBe('x');
  });

  it('reordered becomes edited after a content edit, edited stays edited after a reorder', async () => {
    await db.exec(`update public.photos set sort = 3 where id = '${P1}'`);
    await db.exec(`update public.photos set alt = 'y' where id = '${P1}'`);
    expect(await kinds()).toEqual(['photos:edited']);
    await db.exec(`update public.photos set sort = 4 where id = '${P1}'`);
    expect(await kinds()).toEqual(['photos:edited']);
  });

  it('a row added and deleted before publishing leaves no line', async () => {
    await db.exec(photo(P2, ALB1));
    await db.exec(`delete from public.photos where id = '${P2}'`);
    expect(await lines()).toEqual([]);
  });

  it('a published row that was edited and then deleted is one deleted line', async () => {
    await db.exec(`update public.photos set alt = 'z' where id = '${P1}'`);
    await db.exec(`delete from public.photos where id = '${P1}'`);
    expect((await lines()).map((x) => [x.kind, x.label])).toEqual([['deleted', 'z']]);
  });

  it('clearing a cover by deleting the cover photo shows the album as edited', async () => {
    await db.exec(`update public.albums set cover_photo_id = '${P1}' where id = '${ALB1}'`);
    await db.exec('delete from public.change_log');
    await db.exec(`delete from public.photos where id = '${P1}'`);
    expect(await kinds()).toEqual(['albums:edited', 'photos:deleted']);
  });
});

describe('change_log: panel count equals the lines', () => {
  it('count(*) is the number of distinct changed rows, however often they changed', async () => {
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
