import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asRole, createMigratedDb, seedAdmin } from './helpers/db';
import { functionPrivilegeMatrix, lintPublicSchema } from './helpers/privileges';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const CAT = 'aaaaaaaa-0000-4000-8000-000000000001';
const ALB1 = 'bbbbbbbb-0000-4000-8000-000000000001'; // unpublished
const ALB2 = 'bbbbbbbb-0000-4000-8000-000000000002'; // published
const P1 = 'cccccccc-0000-4000-8000-000000000001'; // in ALB1
const P2 = 'cccccccc-0000-4000-8000-000000000002'; // in ALB2
const MISSING = 'cccccccc-0000-4000-8000-0000000000ff';

let db: PGlite;
const asAdmin = <T>(fn: (d: PGlite) => Promise<T>) => asRole(db, 'authenticated', fn, ADMIN);

const photo = (id: string, alb: string) =>
  `insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total)
   values ('${id}', '${alb}', 'photos/${id}/master.jpg', 1, 1, '{}', 0)`;
const hero = async () => (await db.query<{ h: string | null }>('select hero_photo_id as h from public.site_settings')).rows[0]!.h;
const setHero = (p: string | null) =>
  db.exec(`update public.site_settings set hero_photo_id = ${p === null ? 'null' : `'${p}'`} where id`);
const logRows = async () =>
  (await db.query<{ table_name: string; kind: string; label: string }>(
    `select table_name, kind, label from public.change_log where table_name = 'site_settings'`,
  )).rows;

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
    update public.site_settings set hero_photo_id = null where id;
    delete from public.photos;
    update public.albums set cover_photo_id = null;
    delete from public.albums;
    delete from public.categories;
    delete from public.url_history;
    insert into public.categories (id, slug, name) values ('${CAT}', 'svatby', 'Svatby');
    insert into public.albums (id, category_id, slug, title, published) values
      ('${ALB1}', '${CAT}', 'one', 'One', false),
      ('${ALB2}', '${CAT}', 'two', 'Two', true);
    ${photo(P1, ALB1)};
    ${photo(P2, ALB2)};
    delete from public.change_log;
    update public.site_state set pending_changes = 0 where id;
  `);
});

describe('hero photo: row and check', () => {
  it('has exactly one row, automatic by default', async () => {
    expect((await db.query('select 1 from public.site_settings')).rows).toHaveLength(1);
    expect(await hero()).toBeNull();
  });

  it('accepts a photo of a published or an unpublished album', async () => {
    await setHero(P2);
    expect(await hero()).toBe(P2);
    await setHero(P1);
    expect(await hero()).toBe(P1);
  });

  it('can be set back to null', async () => {
    await setHero(P2);
    await setHero(null);
    expect(await hero()).toBeNull();
  });

  it('rejects an unknown photo with HERO_PHOTO_NOT_FOUND (23503)', async () => {
    await expect(setHero(MISSING)).rejects.toMatchObject({ code: '23503', message: expect.stringContaining('HERO_PHOTO_NOT_FOUND') });
    expect(await hero()).toBeNull();
  });

  it('rejects a second row and a false key', async () => {
    await expect(db.exec('insert into public.site_settings default values')).rejects.toThrow();
    await expect(db.exec('insert into public.site_settings (id) values (false)')).rejects.toThrow();
  });
});

describe('hero photo: clearing', () => {
  it('deleting the photo clears the choice without error', async () => {
    await setHero(P2);
    await db.exec(`delete from public.photos where id = '${P2}'`);
    expect(await hero()).toBeNull();
  });

  it('deleting another photo keeps the choice', async () => {
    await setHero(P2);
    await db.exec(`delete from public.photos where id = '${P1}'`);
    expect(await hero()).toBe(P2);
  });

  it('moving the photo to another album keeps the choice', async () => {
    await setHero(P2);
    await db.exec(`update public.photos set album_id = '${ALB1}' where id = '${P2}'`);
    expect(await hero()).toBe(P2);
  });
});

describe('hero photo: change log and pending counter', () => {
  it('setting the hero logs one edited line with the Czech label and bumps pending', async () => {
    await setHero(P2);
    expect(await logRows()).toEqual([{ table_name: 'site_settings', kind: 'edited', label: 'Hlavní fotka úvodní stránky' }]);
    const p = await db.query<{ n: number }>('select pending_changes as n from public.site_state');
    expect(p.rows[0]!.n).toBeGreaterThan(0);
  });

  it('further changes refresh the same line instead of adding lines', async () => {
    await setHero(P2);
    await setHero(P1);
    await setHero(null);
    expect(await logRows()).toHaveLength(1);
  });

  it('an update that changes nothing is not logged', async () => {
    await setHero(null);
    expect(await logRows()).toEqual([]);
  });

  it('a hero cleared by deleting its photo is logged as edited', async () => {
    await setHero(P2);
    await db.exec(`delete from public.change_log where table_name = 'site_settings'`);
    await db.exec(`delete from public.photos where id = '${P2}'`);
    expect(await logRows()).toEqual([{ table_name: 'site_settings', kind: 'edited', label: 'Hlavní fotka úvodní stránky' }]);
  });

  it('the change_log table check lists the new table', async () => {
    await expect(
      db.exec(`insert into public.change_log (table_name, row_id, kind) values ('bogus', gen_random_uuid(), 'edited')`),
    ).rejects.toThrow(/change_log_table_name/);
  });
});

describe('hero photo: privileges', () => {
  it('check_hero_photo is not executable by API roles and the schema lint is clean', async () => {
    const m = await functionPrivilegeMatrix(db);
    expect(m.check_hero_photo).toEqual({ anon: false, authenticated: false });
    expect(m.log_change).toEqual({ anon: false, authenticated: false });
    expect(await lintPublicSchema(db)).toEqual([]);
  });

  it('anon can neither read nor change the table', async () => {
    await expect(asRole(db, 'anon', (d) => d.query('select hero_photo_id from public.site_settings'))).rejects.toThrow(/permission denied/);
    await expect(
      asRole(db, 'anon', (d) => d.query(`update public.site_settings set hero_photo_id = '${P2}' where id`)),
    ).rejects.toThrow(/permission denied/);
  });

  it('a signed-in non-admin sees no row and cannot change it (row level security)', async () => {
    const seen = await asRole(db, 'authenticated', (d) => d.query('select * from public.site_settings'), OTHER);
    expect(seen.rows).toEqual([]);
    await asRole(db, 'authenticated', (d) => d.query(`update public.site_settings set hero_photo_id = '${P2}' where id`), OTHER);
    expect(await hero()).toBeNull();
  });

  it('an admin can set and clear the hero through the API role', async () => {
    await asAdmin((d) => d.query(`update public.site_settings set hero_photo_id = '${P1}' where id`));
    expect(await hero()).toBe(P1);
    await asAdmin((d) => d.query('update public.site_settings set hero_photo_id = null where id'));
    expect(await hero()).toBeNull();
  });

  it('an admin cannot insert or delete the row, and a foreign photo id is refused with the code', async () => {
    await expect(asAdmin((d) => d.query('delete from public.site_settings where id'))).rejects.toThrow(/permission denied/);
    await expect(asAdmin((d) => d.query('insert into public.site_settings (id) values (true)'))).rejects.toThrow(/permission denied/);
    await expect(
      asAdmin((d) => d.query(`update public.site_settings set hero_photo_id = '${MISSING}' where id`)),
    ).rejects.toThrow(/HERO_PHOTO_NOT_FOUND/);
  });
});
