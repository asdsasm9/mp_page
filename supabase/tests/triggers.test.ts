import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, createMigratedDb, seedAdmin } from './helpers/db';
import { functionPrivilegeMatrix, lintPublicSchema, publicFunctions } from './helpers/privileges';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const CAT = 'aaaaaaaa-0000-4000-8000-000000000001';
const ALB1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const ALB2 = 'bbbbbbbb-0000-4000-8000-000000000002';
const P1 = 'cccccccc-0000-4000-8000-000000000001';
const P2 = 'cccccccc-0000-4000-8000-000000000002';
const P3 = 'cccccccc-0000-4000-8000-000000000003';

let db: PGlite;

const pending = async () =>
  (await db.query<{ n: number }>('select pending_changes as n from public.site_state')).rows[0].n;
const resetPending = () => db.exec('update public.site_state set pending_changes = 0');
const cover = async (alb: string) =>
  (await db.query<{ c: string | null }>(`select cover_photo_id as c from public.albums where id = '${alb}'`)).rows[0].c;
const photo = (id: string, alb: string) =>
  `insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total)
   values ('${id}', '${alb}', 'photos/${id}/master.jpg', 1, 1, '{}', 0)`;

beforeAll(async () => {
  db = await createMigratedDb();
  await seedAdmin(db, ADMIN, 'a@example.test');
  await db.exec(`
    insert into public.categories (id, slug, name) values ('${CAT}', 'svatby', 'Svatby');
    insert into public.albums (id, category_id, slug, title) values
      ('${ALB1}', '${CAT}', 'one', 'One'), ('${ALB2}', '${CAT}', 'two', 'Two');
    ${photo(P1, ALB1)};
    ${photo(P2, ALB1)};
    ${photo(P3, ALB2)};
  `);
});

afterAll(async () => {
  await db.close();
});

describe('migration D: bump_pending', () => {
  it('seed inserts counted one per row', async () => {
    // 1 category + 2 albums + 3 photos
    expect(await pending()).toBe(6);
  });

  it('increments by 1 per inserted row', async () => {
    await resetPending();
    await db.exec(`insert into public.url_history (old_path, status) values ('/a/', 301), ('/b/', 301), ('/c/', 410)`);
    expect(await pending()).toBe(3);
  });

  it('increments by 1 per updated row and per deleted row', async () => {
    await resetPending();
    await db.exec(`update public.photos set sort = 7 where album_id = '${ALB1}'`);
    expect(await pending()).toBe(2);
    await db.exec(`delete from public.url_history`);
    expect(await pending()).toBe(5);
  });

  it('does not increment for a statement that changes zero rows', async () => {
    await resetPending();
    await db.exec(`update public.albums set title = 'x' where slug = 'does-not-exist'`);
    await db.exec(`delete from public.categories where slug = 'does-not-exist'`);
    await db.exec(`update public.photos set sort = 1 where false`);
    expect(await pending()).toBe(0);
  });

  it('counts a change made by an admin through the API role too (definer rights)', async () => {
    await resetPending();
    await asRole(db, 'authenticated', (d) => d.query(`update public.photos set alt = 'hello' where id = '${P3}'`), ADMIN);
    expect(await pending()).toBe(1);
  });

  it('every bump comes from a row-level trigger on the four content tables and the site settings', async () => {
    const r = await db.query<{ tbl: string; row_level: boolean }>(
      `select c.relname as tbl, (t.tgtype & 1) = 1 as row_level
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where t.tgname like '%_bump_pending' and not t.tgisinternal order by c.relname`,
    );
    expect(r.rows).toEqual([
      { tbl: 'albums', row_level: true },
      { tbl: 'categories', row_level: true },
      { tbl: 'photos', row_level: true },
      { tbl: 'site_settings', row_level: true },
      { tbl: 'url_history', row_level: true },
    ]);
  });
});

describe('migration D: set_updated_at', () => {
  it('moves updated_at on categories, albums and photos', async () => {
    const old = `'2000-01-01T00:00:00Z'`;
    await db.exec(`
      alter table public.categories disable trigger categories_set_updated_at;
      alter table public.albums disable trigger albums_set_updated_at;
      alter table public.photos disable trigger photos_set_updated_at;
      update public.categories set updated_at = ${old};
      update public.albums set updated_at = ${old};
      update public.photos set updated_at = ${old};
      alter table public.categories enable trigger categories_set_updated_at;
      alter table public.albums enable trigger albums_set_updated_at;
      alter table public.photos enable trigger photos_set_updated_at;
      update public.categories set name = 'Svatby 2';
      update public.albums set title = 'Changed';
      update public.photos set caption = 'c';
    `);
    for (const t of ['categories', 'albums', 'photos']) {
      const r = await db.query<{ moved: boolean }>(`select bool_and(updated_at > ${old}::timestamptz) as moved from public.${t}`);
      expect(r.rows[0].moved, t).toBe(true);
    }
  });

  it('a client cannot set updated_at to a chosen value', async () => {
    await db.exec(`update public.categories set updated_at = '2001-01-01T00:00:00Z'`);
    const r = await db.query<{ ok: boolean }>(`select updated_at > '2020-01-01' as ok from public.categories`);
    expect(r.rows[0].ok).toBe(true);
  });
});

describe('migration D: cover photo rules', () => {
  it('a cover that belongs to the album is accepted', async () => {
    await db.exec(`update public.albums set cover_photo_id = '${P1}' where id = '${ALB1}'`);
    expect(await cover(ALB1)).toBe(P1);
  });

  it('a cover pointing at another album photo is refused (update)', async () => {
    await expect(
      db.exec(`update public.albums set cover_photo_id = '${P3}' where id = '${ALB1}'`),
    ).rejects.toThrow(/COVER_NOT_IN_ALBUM/);
    expect(await cover(ALB1)).toBe(P1);
  });

  it('a cover on a brand new album is refused (no photos can be in it yet)', async () => {
    await expect(
      db.exec(`insert into public.albums (category_id, slug, title, cover_photo_id) values ('${CAT}', 'fresh', 'Fresh', '${P1}')`),
    ).rejects.toThrow(/COVER_NOT_IN_ALBUM/);
  });

  it('an unrelated album update does not re-check or touch the cover', async () => {
    await db.exec(`update public.albums set title = 'One again' where id = '${ALB1}'`);
    expect(await cover(ALB1)).toBe(P1);
  });

  it('moving the cover photo to another album clears the cover without error', async () => {
    await db.exec(`update public.photos set album_id = '${ALB2}' where id = '${P1}'`);
    expect(await cover(ALB1)).toBeNull();
    await db.exec(`update public.photos set album_id = '${ALB1}' where id = '${P1}'`);
  });

  it('changing other photo columns keeps the cover', async () => {
    await db.exec(`update public.albums set cover_photo_id = '${P1}' where id = '${ALB1}'`);
    await db.exec(`update public.photos set alt = 'still cover', sort = 3 where id = '${P1}'`);
    expect(await cover(ALB1)).toBe(P1);
  });

  it('deleting the cover photo clears the cover without error', async () => {
    await db.exec(`delete from public.photos where id = '${P1}'`);
    expect(await cover(ALB1)).toBeNull();
    const r = await db.query(`select 1 from public.photos where id = '${P1}'`);
    expect(r.rows).toEqual([]);
  });

  it('only the cover of the affected photo is cleared', async () => {
    await db.exec(`update public.albums set cover_photo_id = '${P3}' where id = '${ALB2}'`);
    await db.exec(`delete from public.photos where id = '${P2}'`);
    expect(await cover(ALB2)).toBe(P3);
  });
});

describe('migration D: trigger functions are not callable by API roles', () => {
  it('matrix and lint', async () => {
    const m = await functionPrivilegeMatrix(db);
    for (const name of ['set_updated_at', 'bump_pending', 'check_album_cover', 'clear_cover_on_photo_change']) {
      expect(m[name], name).toEqual({ anon: false, authenticated: false });
    }
    const defs = (await publicFunctions(db)).filter((f) => f.securityDefiner);
    for (const f of defs) expect(f.searchPathEmpty, f.signature).toBe(true);
    expect(await lintPublicSchema(db)).toEqual([]);
  });

  it('an API role cannot call a trigger function directly', async () => {
    await expect(asRole(db, 'authenticated', (d) => d.query('select public.bump_pending()'), ADMIN)).rejects.toThrow(
      /permission denied for function bump_pending/,
    );
  });
});
