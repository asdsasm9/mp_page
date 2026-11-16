import type { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asRole, createMigratedDb, seedAdmin } from './helpers/db';
import { functionPrivilegeMatrix, lintPublicSchema } from './helpers/privileges';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const CAT = 'aaaaaaaa-0000-4000-8000-000000000001';
const ALB = 'bbbbbbbb-0000-4000-8000-000000000001';
const POST = 'dddddddd-0000-4000-8000-000000000001';
const POST2 = 'dddddddd-0000-4000-8000-000000000002';
const MISSING = 'cccccccc-0000-4000-8000-0000000000ff';
const MISSING_POST = 'dddddddd-0000-4000-8000-0000000000ff';
const pid = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PHOTOS = Array.from({ length: 12 }, (_, i) => pid(i + 1));

let db: PGlite;
const asAdmin = <T>(fn: (d: PGlite) => Promise<T>) => asRole(db, 'authenticated', fn, ADMIN);

const arr = (ids: string[]) => `array[${ids.map((i) => `'${i}'`).join(',')}]::uuid[]`;
const rpc = (post: string, ids: string[]) => `select public.ig_set_post_photos('${post}', ${arr(ids)})`;
const link = (post: string, photo: string, sort: number) =>
  `insert into public.ig_post_photos (post_id, photo_id, sort) values ('${post}', '${photo}', ${sort})`;
const photoSorts = async (post: string) =>
  (await db.query<{ photo_id: string; sort: number }>(
    `select photo_id, sort from public.ig_post_photos where post_id = '${post}' order by sort`,
  )).rows;
const count = async (table: string) =>
  (await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`)).rows[0]!.n;
const pending = async () =>
  (await db.query<{ n: number }>('select pending_changes as n from public.site_state')).rows[0]!.n;
const logCount = () => count('change_log');

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
    delete from public.ig_posts;
    delete from public.photos;
    update public.albums set cover_photo_id = null;
    delete from public.albums;
    delete from public.categories;
    delete from public.url_history;
    insert into public.categories (id, slug, name) values ('${CAT}', 'svatby', 'Svatby');
    insert into public.albums (id, category_id, slug, title, published) values ('${ALB}', '${CAT}', 'one', 'One', true);
    ${PHOTOS.map(
      (p) => `insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total)
              values ('${p}', '${ALB}', 'photos/${p}/master.jpg', 1, 1, '{}', 0);`,
    ).join('\n')}
    insert into public.ig_posts (id) values ('${POST}'), ('${POST2}');
    delete from public.change_log;
    update public.site_state set pending_changes = 0 where id;
  `);
});

describe('ig tables: constraints', () => {
  it('has sensible defaults', async () => {
    const r = await db.query<Record<string, unknown>>(`select * from public.ig_posts where id = '${POST}'`);
    expect(r.rows[0]).toMatchObject({ caption: '', hashtags: '', planned_on: null, status: 'draft', posted_at: null, sort: 0 });
  });

  it('accepts the three statuses with a matching posted_at', async () => {
    await db.exec(`update public.ig_posts set status = 'planned' where id = '${POST}'`);
    await db.exec(`update public.ig_posts set status = 'posted', posted_at = now() where id = '${POST}'`);
    await db.exec(`update public.ig_posts set status = 'draft', posted_at = null where id = '${POST}'`);
  });

  it('rejects an unknown status', async () => {
    await expect(db.exec(`update public.ig_posts set status = 'live' where id = '${POST}'`)).rejects.toThrow(/ig_posts_status/);
  });

  it('caption and hashtags: 2200 characters pass, 2201 fail', async () => {
    await db.exec(`update public.ig_posts set caption = repeat('a', 2200), hashtags = repeat('b', 2200) where id = '${POST}'`);
    await expect(db.exec(`update public.ig_posts set caption = repeat('a', 2201) where id = '${POST}'`)).rejects.toThrow(
      /ig_posts_caption_length/,
    );
    await expect(db.exec(`update public.ig_posts set hashtags = repeat('b', 2201) where id = '${POST}'`)).rejects.toThrow(
      /ig_posts_hashtags_length/,
    );
  });

  it('posted needs posted_at and posted_at needs posted', async () => {
    await expect(db.exec(`update public.ig_posts set status = 'posted' where id = '${POST}'`)).rejects.toThrow(
      /ig_posts_posted_matches_status/,
    );
    await expect(db.exec(`update public.ig_posts set posted_at = now() where id = '${POST}'`)).rejects.toThrow(
      /ig_posts_posted_matches_status/,
    );
    await expect(db.exec(`update public.ig_posts set status = 'planned', posted_at = now() where id = '${POST}'`)).rejects.toThrow(
      /ig_posts_posted_matches_status/,
    );
  });

  it('photo sort must be 1..10', async () => {
    await expect(db.exec(link(POST, PHOTOS[0]!, 0))).rejects.toThrow(/ig_post_photos_sort_range/);
    await expect(db.exec(link(POST, PHOTOS[0]!, 11))).rejects.toThrow(/ig_post_photos_sort_range/);
    await db.exec(link(POST, PHOTOS[0]!, 1));
    await db.exec(link(POST, PHOTOS[1]!, 10));
  });

  it('an 11th photo cannot be added to a post with ten', async () => {
    for (let i = 0; i < 10; i++) await db.exec(link(POST, PHOTOS[i]!, i + 1));
    await expect(db.exec(link(POST, PHOTOS[10]!, 11))).rejects.toThrow(/ig_post_photos_sort_range/);
    await expect(db.exec(link(POST, PHOTOS[10]!, 5))).rejects.toThrow(/ig_post_photos_post_sort_key/);
    expect(await photoSorts(POST)).toHaveLength(10);
  });

  it('the same photo twice in a post and the same sort twice are refused', async () => {
    await db.exec(link(POST, PHOTOS[0]!, 1));
    await expect(db.exec(link(POST, PHOTOS[0]!, 2))).rejects.toThrow(/ig_post_photos_pkey/);
    await expect(db.exec(link(POST, PHOTOS[1]!, 1))).rejects.toThrow(/ig_post_photos_post_sort_key/);
  });

  it('one photo may be in several posts', async () => {
    await db.exec(link(POST, PHOTOS[0]!, 1));
    await db.exec(link(POST2, PHOTOS[0]!, 1));
  });

  it('a link needs an existing post and an existing photo', async () => {
    await expect(db.exec(link(MISSING_POST, PHOTOS[0]!, 1))).rejects.toMatchObject({ code: '23503' });
    await expect(db.exec(link(POST, MISSING, 1))).rejects.toMatchObject({ code: '23503' });
  });

  it('updated_at moves on update', async () => {
    const before = (await db.query<{ t: string }>(`select updated_at::text as t from public.ig_posts where id = '${POST}'`)).rows[0]!.t;
    await db.exec(`select pg_sleep(0.01)`);
    await db.exec(`update public.ig_posts set caption = 'x' where id = '${POST}'`);
    const after = (await db.query<{ t: string }>(`select updated_at::text as t from public.ig_posts where id = '${POST}'`)).rows[0]!.t;
    expect(after).not.toBe(before);
  });
});

describe('ig tables: cascades', () => {
  beforeEach(async () => {
    await db.exec(link(POST, PHOTOS[0]!, 1));
    await db.exec(link(POST, PHOTOS[1]!, 2));
    await db.exec(link(POST, PHOTOS[2]!, 3));
    await db.exec(link(POST2, PHOTOS[1]!, 1));
  });

  it('deleting a photo removes it from every post and keeps the other sorts', async () => {
    await db.exec(`delete from public.photos where id = '${PHOTOS[1]}'`);
    expect(await photoSorts(POST)).toEqual([
      { photo_id: PHOTOS[0], sort: 1 },
      { photo_id: PHOTOS[2], sort: 3 },
    ]);
    expect(await photoSorts(POST2)).toEqual([]);
    expect(await count('ig_posts')).toBe(2);
  });

  it('delete_photos (the admin API) cascades too', async () => {
    await asAdmin((d) => d.query(`select public.delete_photos(${arr([PHOTOS[0]!, PHOTOS[1]!])})`));
    expect(await photoSorts(POST)).toEqual([{ photo_id: PHOTOS[2], sort: 3 }]);
    expect(await photoSorts(POST2)).toEqual([]);
  });

  it('deleting a post removes its links but never a photo', async () => {
    await db.exec(`delete from public.ig_posts where id = '${POST}'`);
    expect(await photoSorts(POST)).toEqual([]);
    expect(await photoSorts(POST2)).toHaveLength(1);
    expect(await count('photos')).toBe(PHOTOS.length);
  });
});

describe('ig_set_post_photos', () => {
  it('replaces the set atomically with sort 1..n in array order', async () => {
    await db.exec(link(POST, PHOTOS[5]!, 4));
    await asAdmin((d) => d.query(rpc(POST, [PHOTOS[2]!, PHOTOS[0]!, PHOTOS[1]!])));
    expect(await photoSorts(POST)).toEqual([
      { photo_id: PHOTOS[2], sort: 1 },
      { photo_id: PHOTOS[0], sort: 2 },
      { photo_id: PHOTOS[1], sort: 3 },
    ]);
  });

  it('accepts one and ten photos, and reordering the same set', async () => {
    await asAdmin((d) => d.query(rpc(POST, [PHOTOS[0]!])));
    expect(await photoSorts(POST)).toHaveLength(1);
    const ten = PHOTOS.slice(0, 10);
    await asAdmin((d) => d.query(rpc(POST, ten)));
    expect((await photoSorts(POST)).map((r) => r.photo_id)).toEqual(ten);
    await asAdmin((d) => d.query(rpc(POST, [...ten].reverse())));
    expect((await photoSorts(POST)).map((r) => r.photo_id)).toEqual([...ten].reverse());
  });

  it('refuses an empty list, a null list, 11 ids, duplicates and a null id with 23514', async () => {
    await db.exec(link(POST, PHOTOS[0]!, 1));
    const bad = [
      rpc(POST, []),
      `select public.ig_set_post_photos('${POST}', null)`,
      rpc(POST, PHOTOS.slice(0, 11)),
      rpc(POST, [PHOTOS[0]!, PHOTOS[0]!]),
      `select public.ig_set_post_photos('${POST}', array['${PHOTOS[0]}', null]::uuid[])`,
    ];
    for (const sql of bad) {
      await expect(asAdmin((d) => d.query(sql))).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('IG_PHOTOS_INVALID') });
    }
    expect(await photoSorts(POST)).toEqual([{ photo_id: PHOTOS[0], sort: 1 }]);
  });

  it('refuses an unknown post or photo with 23503 and leaves the old set untouched (atomic)', async () => {
    await db.exec(link(POST, PHOTOS[0]!, 1));
    await db.exec(link(POST, PHOTOS[1]!, 2));
    await expect(asAdmin((d) => d.query(rpc(MISSING_POST, [PHOTOS[2]!])))).rejects.toMatchObject({
      code: '23503',
      message: expect.stringContaining('IG_POST_NOT_FOUND'),
    });
    await expect(asAdmin((d) => d.query(rpc(POST, [PHOTOS[2]!, MISSING])))).rejects.toMatchObject({
      code: '23503',
      message: expect.stringContaining('IG_PHOTO_NOT_FOUND'),
    });
    expect(await photoSorts(POST)).toEqual([
      { photo_id: PHOTOS[0], sort: 1 },
      { photo_id: PHOTOS[1], sort: 2 },
    ]);
  });

  it('touches updated_at of the post', async () => {
    const q = `select updated_at::text as t from public.ig_posts where id = '${POST}'`;
    const before = (await db.query<{ t: string }>(q)).rows[0]!.t;
    await db.exec(`select pg_sleep(0.01)`);
    await asAdmin((d) => d.query(rpc(POST, [PHOTOS[0]!])));
    expect((await db.query<{ t: string }>(q)).rows[0]!.t).not.toBe(before);
  });

  it('is refused for anon (no execute) and for a non-admin (NOT_ADMIN, 42501)', async () => {
    await expect(asRole(db, 'anon', (d) => d.query(rpc(POST, [PHOTOS[0]!])))).rejects.toThrow(/permission denied/);
    await expect(asRole(db, 'authenticated', (d) => d.query(rpc(POST, [PHOTOS[0]!])), OTHER)).rejects.toMatchObject({
      code: '42501',
      message: expect.stringContaining('NOT_ADMIN'),
    });
    expect(await photoSorts(POST)).toEqual([]);
  });
});

describe('ig tables: privileges', () => {
  it('the function matrix and the schema lint are clean', async () => {
    const m = await functionPrivilegeMatrix(db);
    expect(m.ig_set_post_photos).toEqual({ anon: false, authenticated: true });
    expect(await lintPublicSchema(db)).toEqual([]);
  });

  it('anon can neither read nor write either table', async () => {
    for (const t of ['ig_posts', 'ig_post_photos']) {
      await expect(asRole(db, 'anon', (d) => d.query(`select * from public.${t}`))).rejects.toThrow(/permission denied/);
    }
    await expect(asRole(db, 'anon', (d) => d.query(`insert into public.ig_posts (caption) values ('x')`))).rejects.toThrow(/permission denied/);
    await expect(asRole(db, 'anon', (d) => d.query(`delete from public.ig_posts where id = '${POST}'`))).rejects.toThrow(/permission denied/);
  });

  it('a signed-in non-admin sees nothing and changes nothing (row level security)', async () => {
    await db.exec(link(POST, PHOTOS[0]!, 1));
    const asOther = <T>(fn: (d: PGlite) => Promise<T>) => asRole(db, 'authenticated', fn, OTHER);
    expect((await asOther((d) => d.query('select * from public.ig_posts'))).rows).toEqual([]);
    expect((await asOther((d) => d.query('select * from public.ig_post_photos'))).rows).toEqual([]);
    await asOther((d) => d.query(`update public.ig_posts set caption = 'hacked' where id = '${POST}'`));
    await asOther((d) => d.query(`delete from public.ig_post_photos where post_id = '${POST}'`));
    await expect(asOther((d) => d.query(`insert into public.ig_posts (caption) values ('x')`))).rejects.toThrow(/row-level security/);
    expect((await db.query<{ caption: string }>(`select caption from public.ig_posts where id = '${POST}'`)).rows[0]!.caption).toBe('');
    expect(await photoSorts(POST)).toHaveLength(1);
  });

  it('an admin can select, insert, update and delete both tables', async () => {
    const id = 'dddddddd-0000-4000-8000-0000000000aa';
    await asAdmin((d) => d.query(`insert into public.ig_posts (id, caption, status) values ('${id}', 'hello', 'planned')`));
    await asAdmin((d) => d.query(link(id, PHOTOS[0]!, 1)));
    await asAdmin((d) => d.query(`update public.ig_post_photos set sort = 2 where post_id = '${id}'`));
    await asAdmin((d) => d.query(`update public.ig_posts set caption = 'changed' where id = '${id}'`));
    const seen = await asAdmin((d) => d.query<{ caption: string }>(`select caption from public.ig_posts where id = '${id}'`));
    expect(seen.rows[0]!.caption).toBe('changed');
    expect(await photoSorts(id)).toEqual([{ photo_id: PHOTOS[0], sort: 2 }]);
    await asAdmin((d) => d.query(`delete from public.ig_posts where id = '${id}'`));
    expect(await photoSorts(id)).toEqual([]);
  });

  it('the admin cannot use the API to push a bad value through (checks still apply)', async () => {
    await expect(
      asAdmin((d) => d.query(`insert into public.ig_posts (status) values ('bogus')`)),
    ).rejects.toThrow(/ig_posts_status/);
  });
});

describe('ig tables: not tracked as site changes', () => {
  it('only set_updated_at is attached to ig_posts, nothing to ig_post_photos', async () => {
    const trig = async (t: string) =>
      (await db.query<{ tgname: string; fn: string }>(
        `select t.tgname, p.proname as fn from pg_trigger t join pg_proc p on p.oid = t.tgfoid
          where t.tgrelid = 'public.${t}'::regclass and not t.tgisinternal order by t.tgname`,
      )).rows;
    expect(await trig('ig_posts')).toEqual([{ tgname: 'ig_posts_set_updated_at', fn: 'set_updated_at' }]);
    expect(await trig('ig_post_photos')).toEqual([]);
  });

  it('change_log and pending_changes stay unchanged by inserts, updates, deletes and the RPC', async () => {
    const before = { p: await pending(), l: await logCount() };
    await asAdmin((d) => d.query(`insert into public.ig_posts (id, caption) values ('dddddddd-0000-4000-8000-0000000000bb', 'x')`));
    await asAdmin((d) => d.query(rpc('dddddddd-0000-4000-8000-0000000000bb', [PHOTOS[0]!, PHOTOS[1]!])));
    await asAdmin((d) => d.query(`update public.ig_posts set status = 'planned', caption = 'y' where id = '${POST}'`));
    await asAdmin((d) => d.query(rpc(POST, [PHOTOS[3]!])));
    await asAdmin((d) => d.query(`update public.ig_post_photos set sort = 5 where post_id = '${POST}'`));
    await asAdmin((d) => d.query(`delete from public.ig_post_photos where post_id = '${POST}'`));
    await asAdmin((d) => d.query(`delete from public.ig_posts where id = '${POST2}'`));
    expect({ p: await pending(), l: await logCount() }).toEqual(before);
  });

  it('deleting a photo counts as a photo change but adds no ig line to the change log', async () => {
    await db.exec(link(POST, PHOTOS[0]!, 1));
    await db.exec(`delete from public.photos where id = '${PHOTOS[0]}'`);
    const tables = (await db.query<{ table_name: string }>('select table_name from public.change_log')).rows.map((r) => r.table_name);
    expect(tables.every((t) => t === 'photos')).toBe(true);
  });

  it('no file of the Worker source or the snapshot builder mentions the ig tables', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const root = join(here, '..', '..');
    const files = readdirSync(join(root, 'apps', 'api', 'src'), { recursive: true })
      .map((f) => String(f))
      // WP-16: the avatar cleanup route reads the saved avatar_key (read only, caller JWT) to know which file to keep.
      .filter((f) => /\.(ts|tsx)$/.test(f) && f !== join('routes', 'ig-avatar.ts'))
      .map((f) => join(root, 'apps', 'api', 'src', f));
    files.push(join(root, 'packages', 'shared', 'src', 'snapshot.ts'));
    expect(files.length).toBeGreaterThan(1);
    for (const f of files) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/ig_posts|ig_post_photos|ig_set_post_photos|ig_profile/);
    }
  });
});
