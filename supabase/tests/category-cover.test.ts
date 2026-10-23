import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asRole, createMigratedDb, seedAdmin } from './helpers/db';
import { functionPrivilegeMatrix, lintPublicSchema } from './helpers/privileges';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const CAT = 'aaaaaaaa-0000-4000-8000-000000000001';
const CAT2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const ALB1 = 'bbbbbbbb-0000-4000-8000-000000000001'; // CAT, unpublished
const ALB2 = 'bbbbbbbb-0000-4000-8000-000000000002'; // CAT, published
const ALB3 = 'bbbbbbbb-0000-4000-8000-000000000003'; // CAT2
const P1 = 'cccccccc-0000-4000-8000-000000000001'; // in ALB1
const P2 = 'cccccccc-0000-4000-8000-000000000002'; // in ALB2
const P3 = 'cccccccc-0000-4000-8000-000000000003'; // in ALB3

let db: PGlite;
const asAdmin = <T>(fn: (d: PGlite) => Promise<T>) => asRole(db, 'authenticated', fn, ADMIN);

const photo = (id: string, alb: string) =>
  `insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total)
   values ('${id}', '${alb}', 'photos/${id}/master.jpg', 1, 1, '{}', 0)`;
const cover = async (cat = CAT) =>
  (await db.query<{ c: string | null }>(`select cover_photo_id as c from public.categories where id = '${cat}'`)).rows[0].c;
const setCover = (p: string, cat = CAT) => db.exec(`update public.categories set cover_photo_id = '${p}' where id = '${cat}'`);

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
    update public.categories set cover_photo_id = null;
    delete from public.photos;
    update public.albums set cover_photo_id = null;
    delete from public.albums;
    delete from public.categories;
    delete from public.url_history;
    delete from public.change_log;
    insert into public.categories (id, slug, name) values ('${CAT}', 'svatby', 'Svatby'), ('${CAT2}', 'portrety', 'Portréty');
    insert into public.albums (id, category_id, slug, title, published) values
      ('${ALB1}', '${CAT}', 'one', 'One', false),
      ('${ALB2}', '${CAT}', 'two', 'Two', true),
      ('${ALB3}', '${CAT2}', 'three', 'Three', true);
    ${photo(P1, ALB1)};
    ${photo(P2, ALB2)};
    ${photo(P3, ALB3)};
    delete from public.change_log;
    update public.site_state set pending_changes = 0;
  `);
});

describe('category cover: check', () => {
  it('has no cover by default', async () => {
    expect(await cover()).toBeNull();
  });

  it('accepts a photo of a published album of the category', async () => {
    await setCover(P2);
    expect(await cover()).toBe(P2);
  });

  it('accepts a photo of an unpublished album of the category', async () => {
    await setCover(P1);
    expect(await cover()).toBe(P1);
  });

  it('rejects a photo of another category with CATEGORY_COVER_NOT_IN_CATEGORY (23514)', async () => {
    await expect(setCover(P3)).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('CATEGORY_COVER_NOT_IN_CATEGORY') });
    expect(await cover()).toBeNull();
  });

  it('rejects a foreign-category photo sent as an admin through the API role (direct REST)', async () => {
    await expect(asAdmin((d) => d.query(`update public.categories set cover_photo_id = '${P3}' where id = '${CAT}'`))).rejects.toThrow(
      /CATEGORY_COVER_NOT_IN_CATEGORY/,
    );
  });

  it('rejects a cover on insert of a category (it has no albums yet)', async () => {
    await expect(
      db.exec(`insert into public.categories (slug, name, cover_photo_id) values ('fresh', 'Fresh', '${P1}')`),
    ).rejects.toThrow(/CATEGORY_COVER_NOT_IN_CATEGORY/);
  });

  it('an unrelated category update does not touch the cover', async () => {
    await setCover(P2);
    await db.exec(`update public.categories set name = 'Svatby 2' where id = '${CAT}'`);
    expect(await cover()).toBe(P2);
  });

  it('can be set back to null', async () => {
    await setCover(P2);
    await db.exec(`update public.categories set cover_photo_id = null where id = '${CAT}'`);
    expect(await cover()).toBeNull();
  });
});

describe('category cover: clearing', () => {
  it('deleting the photo clears the cover without error', async () => {
    await setCover(P2);
    await db.exec(`delete from public.photos where id = '${P2}'`);
    expect(await cover()).toBeNull();
  });

  it('moving the photo to an album of another category clears the cover', async () => {
    await setCover(P2);
    await db.exec(`update public.photos set album_id = '${ALB3}' where id = '${P2}'`);
    expect(await cover()).toBeNull();
  });

  it('moving the photo to another album of the same category keeps the cover', async () => {
    await setCover(P2);
    await db.exec(`update public.photos set album_id = '${ALB1}' where id = '${P2}'`);
    expect(await cover()).toBe(P2);
  });

  it('other photo changes keep the cover', async () => {
    await setCover(P2);
    await db.exec(`update public.photos set alt = 'x', sort = 4 where id = '${P2}'`);
    expect(await cover()).toBe(P2);
  });

  it('deleting another photo keeps the cover', async () => {
    await setCover(P2);
    await db.exec(`delete from public.photos where id = '${P1}'`);
    expect(await cover()).toBe(P2);
  });

  it('moving the album of the cover photo to another category clears the cover', async () => {
    await setCover(P2);
    await db.exec(`update public.albums set category_id = '${CAT2}' where id = '${ALB2}'`);
    expect(await cover()).toBeNull();
  });

  it('moving another album of the category keeps the cover', async () => {
    await setCover(P2);
    await db.exec(`update public.albums set category_id = '${CAT2}' where id = '${ALB1}'`);
    expect(await cover()).toBe(P2);
  });

  it('moving an album into a category does not touch that category cover', async () => {
    await db.exec(`update public.categories set cover_photo_id = null`);
    await db.exec(`update public.albums set category_id = '${CAT2}' where id = '${ALB1}'`);
    await db.exec(`update public.categories set cover_photo_id = '${P3}' where id = '${CAT2}'`);
    await db.exec(`update public.albums set category_id = '${CAT2}' where id = '${ALB2}'`);
    expect(await cover(CAT2)).toBe(P3);
  });
});

describe('category cover: change log and pending counter', () => {
  it('setting the cover logs the category as edited and bumps pending', async () => {
    await setCover(P2);
    const r = await db.query<{ table_name: string; kind: string; label: string }>(
      `select table_name, kind, label from public.change_log where table_name = 'categories'`,
    );
    expect(r.rows).toEqual([{ table_name: 'categories', kind: 'edited', label: 'Svatby' }]);
    const p = await db.query<{ n: number }>('select pending_changes as n from public.site_state');
    expect(p.rows[0].n).toBeGreaterThan(0);
  });

  it('a cleared cover (photo deleted) is also logged as an edit of the category', async () => {
    await setCover(P2);
    await db.exec(`delete from public.change_log`);
    await db.exec(`delete from public.photos where id = '${P2}'`);
    const r = await db.query<{ kind: string }>(`select kind from public.change_log where table_name = 'categories' and row_id = '${CAT}'`);
    expect(r.rows).toEqual([{ kind: 'edited' }]);
  });
});

describe('category cover: privileges', () => {
  it('trigger functions are not executable by API roles', async () => {
    const m = await functionPrivilegeMatrix(db);
    for (const name of ['check_category_cover', 'clear_category_cover_on_photo_change', 'clear_category_cover_on_album_move']) {
      expect(m[name], name).toEqual({ anon: false, authenticated: false });
    }
    expect(await lintPublicSchema(db)).toEqual([]);
  });

  it('anon cannot read or change the column', async () => {
    await expect(asRole(db, 'anon', (d) => d.query('select cover_photo_id from public.categories'))).rejects.toThrow(/permission denied/);
    await expect(
      asRole(db, 'anon', (d) => d.query(`update public.categories set cover_photo_id = '${P2}' where id = '${CAT}'`)),
    ).rejects.toThrow(/permission denied/);
  });

  it('a signed-in non-admin cannot change the cover (row level security hides the row)', async () => {
    await asRole(db, 'authenticated', (d) => d.query(`update public.categories set cover_photo_id = '${P2}' where id = '${CAT}'`), OTHER);
    expect(await cover()).toBeNull();
  });

  it('an admin can set and clear the cover through the API role', async () => {
    await asAdmin((d) => d.query(`update public.categories set cover_photo_id = '${P1}' where id = '${CAT}'`));
    expect(await cover()).toBe(P1);
    await asAdmin((d) => d.query(`update public.categories set cover_photo_id = null where id = '${CAT}'`));
    expect(await cover()).toBeNull();
  });
});
