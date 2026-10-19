import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RESERVED_CATEGORY_SLUGS, isValidSlug } from '../../packages/shared/src/slug';
import { DB_COLUMNS } from '../../packages/shared/src/db';
import { asRole, createMigratedDb } from './helpers/db';
import { tablePrivilegeMatrix } from './helpers/privileges';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const CAT = 'aaaaaaaa-0000-4000-8000-000000000001';
const ALB = 'bbbbbbbb-0000-4000-8000-000000000001';
const PHO = 'cccccccc-0000-4000-8000-000000000001';

let db: PGlite;

const asAdmin = <T>(fn: (d: PGlite) => Promise<T>) => asRole(db, 'authenticated', fn, ADMIN);
const asOther = <T>(fn: (d: PGlite) => Promise<T>) => asRole(db, 'authenticated', fn, OTHER);
const asAnon = <T>(fn: (d: PGlite) => Promise<T>) => asRole(db, 'anon', fn);

const variants = JSON.stringify({
  master: { w: 3000, h: 2000, bytes: 100 },
  webp: [{ tier: 480, w: 480, h: 320, bytes: 10 }],
  jpeg: { w: 1600, h: 1067, bytes: 20 },
  og: { w: 1200, h: 630, bytes: 5 },
});

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN}', 'a@example.test'), ('${OTHER}', 'o@example.test');
    insert into public.admins (user_id) values ('${ADMIN}');
    insert into public.categories (id, slug, name) values ('${CAT}', 'svatby', 'Svatby');
    insert into public.albums (id, category_id, slug, title) values ('${ALB}', '${CAT}', 'pavla_rafael', 'Pavla');
    insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total)
      values ('${PHO}', '${ALB}', 'photos/${PHO}/master.jpg', 3000, 2000, '${variants}', 135);
    insert into public.url_history (old_path, target, status) values ('/stara/', '/nova/', 301);
  `);
});

afterAll(async () => {
  await db.close();
});

const TABLES = ['categories', 'albums', 'photos', 'url_history'] as const;

describe('migration B: 3-role matrix per table', () => {
  for (const t of TABLES) {
    it(`${t}: anon is denied`, async () => {
      await expect(asAnon((d) => d.query(`select * from public.${t}`))).rejects.toThrow(/permission denied/);
      await expect(asAnon((d) => d.query(`delete from public.${t}`))).rejects.toThrow(/permission denied/);
    });

    it(`${t}: a non-admin authenticated user sees zero rows`, async () => {
      const r = await asOther((d) => d.query(`select * from public.${t}`));
      expect(r.rows).toEqual([]);
    });

    it(`${t}: an admin sees the rows`, async () => {
      const r = await asAdmin((d) => d.query(`select * from public.${t}`));
      expect(r.rows).toHaveLength(1);
    });
  }

  it('non-admin writes are refused on categories, albums and url_history', async () => {
    await expect(
      asOther((d) => d.query(`insert into public.categories (slug, name) values ('x1', 'X')`)),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asOther((d) => d.query(`insert into public.albums (category_id, slug, title) values ('${CAT}', 'x1', 'X')`)),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asOther((d) => d.query(`insert into public.url_history (old_path, status) values ('/x/', 410)`)),
    ).rejects.toThrow(/row-level security/);
  });

  it('non-admin update and delete touch no rows', async () => {
    const u = await asOther((d) => d.query(`update public.categories set name = 'hacked'`));
    expect(u.affectedRows).toBe(0);
    const del = await asOther((d) => d.query(`delete from public.albums`));
    expect(del.affectedRows).toBe(0);
    const p = await asOther((d) => d.query(`update public.photos set alt = 'hacked'`));
    expect(p.affectedRows).toBe(0);
    const r = await db.query<{ name: string }>('select name from public.categories');
    expect(r.rows[0].name).toBe('Svatby');
  });

  it('admin can insert, update and delete categories, albums and url_history', async () => {
    await asAdmin(async (d) => {
      await d.query(`insert into public.categories (id, slug, name) values ('aaaaaaaa-0000-4000-8000-000000000002', 'portrety', 'Portrety')`);
      await d.query(`update public.categories set name = 'Portréty' where slug = 'portrety'`);
      await d.query(`insert into public.albums (category_id, slug, title) values ('aaaaaaaa-0000-4000-8000-000000000002', 'tmp', 'Tmp')`);
      await d.query(`delete from public.albums where slug = 'tmp'`);
      await d.query(`delete from public.categories where slug = 'portrety'`);
      await d.query(`insert into public.url_history (old_path, status) values ('/gone/', 410)`);
      await d.query(`delete from public.url_history where old_path = '/gone/'`);
    });
  });

  it('admin can update only album_id, sort, alt and caption on photos', async () => {
    await asAdmin(async (d) => {
      await d.query(`update public.photos set sort = 5, alt = 'Alt text', caption = 'Cap' where id = '${PHO}'`);
    });
    const r = await db.query<{ sort: number; alt: string }>(`select sort, alt from public.photos where id = '${PHO}'`);
    expect(r.rows[0]).toEqual({ sort: 5, alt: 'Alt text' });
    for (const col of ['master_key', 'width', 'bytes_total', 'variants', 'legacy_key', 'id']) {
      await expect(
        asAdmin((d) => d.query(`update public.photos set ${col} = ${col} where id = '${PHO}'`)),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('an admin insert on photos fails with permission denied', async () => {
    const id = 'cccccccc-0000-4000-8000-000000000002';
    await expect(
      asAdmin((d) =>
        d.query(
          `insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total)
           values ('${id}', '${ALB}', 'photos/${id}/master.jpg', 1, 1, '{}', 0)`,
        ),
      ),
    ).rejects.toThrow(/permission denied for table photos/);
  });

  it('an admin delete on photos fails with permission denied', async () => {
    await expect(asAdmin((d) => d.query(`delete from public.photos where id = '${PHO}'`))).rejects.toThrow(
      /permission denied for table photos/,
    );
  });

  it('privilege matrix is exactly as designed (D-5 tightened photos)', async () => {
    const m = await tablePrivilegeMatrix(db);
    const none = { select: 'none', insert: 'none', update: 'none', delete: 'none' };
    const full = { select: 'table', insert: 'table', update: 'table', delete: 'table' };
    for (const t of ['categories', 'albums', 'url_history']) {
      expect(m[t].anon).toEqual(none);
      expect(m[t].authenticated).toEqual(full);
    }
    expect(m.photos.anon).toEqual(none);
    expect(m.photos.authenticated).toEqual({
      select: 'table',
      insert: 'none',
      update: 'columns:album_id,alt,caption,sort',
      delete: 'none',
    });
  });
});

describe('migration B: constraints', () => {
  const insertCat = (slug: string) => db.query(`insert into public.categories (slug, name) values ($1, 'N')`, [slug]);
  const insertAlb = (slug: string) =>
    db.query(`insert into public.albums (category_id, slug, title) values ($1, $2, 'T')`, [CAT, slug]);

  const slugCases: Array<[string, boolean, boolean]> = [
    // slug, valid as category, valid as album (TS strict / legacy)
    ['portrety', true, true],
    ['pati-kavarna', true, true],
    ['a1', true, true],
    ['a', false, false],
    ['', false, false],
    ['Svatby', false, false],
    ['-ab', false, false],
    ['ab-', false, false],
    ['a--b', false, false],
    ['a b', false, false],
    ['ab/cd', false, false],
    ['rafael_pavla', false, true],
    ['a__b', false, false],
    ['x'.repeat(60), true, true],
    ['x'.repeat(61), false, false],
    ['rozárka', false, false],
  ];

  it('slug checks match the TS rules (categories strict, albums legacy)', async () => {
    for (const [slug, catOk, albOk] of slugCases) {
      expect(isValidSlug(slug), `TS strict ${slug}`).toBe(catOk);
      expect(isValidSlug(slug, { legacy: true }), `TS legacy ${slug}`).toBe(albOk);
      const catRes = await insertCat(slug).then(() => true, () => false);
      expect(catRes, `DB category ${slug}`).toBe(catOk && !(RESERVED_CATEGORY_SLUGS as readonly string[]).includes(slug));
      const albRes = await insertAlb(slug).then(() => true, () => false);
      expect(albRes, `DB album ${slug}`).toBe(albOk);
      await db.exec(`delete from public.albums where slug = '${slug}'; delete from public.categories where slug = '${slug}'`);
    }
  });

  it('every reserved category slug is refused by the DB, and the lists are identical', async () => {
    for (const slug of RESERVED_CATEGORY_SLUGS) {
      await expect(insertCat(slug), slug).rejects.toThrow(/categories_slug_not_reserved|categories_slug_format/);
    }
    // The DB list is the source text of the constraint; compare it with the TS list.
    const r = await db.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'categories_slug_not_reserved'`,
    );
    const inDb = [...r.rows[0].def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]).sort();
    expect(inDb).toEqual([...RESERVED_CATEGORY_SLUGS].sort());
  });

  it('reserved slugs are valid for albums (only categories reserve them)', async () => {
    await insertAlb('portfolio');
    await db.exec(`delete from public.albums where slug = 'portfolio'`);
  });

  it('duplicate slugs are refused', async () => {
    await expect(insertCat('svatby')).rejects.toThrow(/unique/);
    await expect(insertAlb('pavla_rafael')).rejects.toThrow(/unique/);
  });

  it('master_key must equal photos/<id>/master.jpg', async () => {
    const id = 'cccccccc-0000-4000-8000-0000000000aa';
    await expect(
      db.query(
        `insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total)
         values ($1, $2, 'photos/other/master.jpg', 1, 1, '{}', 0)`,
        [id, ALB],
      ),
    ).rejects.toThrow(/photos_master_key_matches_id/);
  });

  it('photo checks: size, variants object, bytes, colour, alt and caption length', async () => {
    const id = 'cccccccc-0000-4000-8000-0000000000bb';
    const ins = (over: { w?: number; v?: string; b?: number; color?: string | null; alt?: string }) =>
      db.query(
        `insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total, dominant_color, alt)
         values ($1::uuid, $2, 'photos/' || $1::text || '/master.jpg', $3, 1, $4::jsonb, $5, $6, $7)`,
        [id, ALB, over.w ?? 1, over.v ?? '{}', over.b ?? 0, over.color ?? null, over.alt ?? null],
      );
    await expect(ins({ w: 0 })).rejects.toThrow(/photos_size_positive/);
    await expect(ins({ v: '[]' })).rejects.toThrow(/photos_variants_object/);
    await expect(ins({ b: -1 })).rejects.toThrow(/photos_bytes_total_nonneg/);
    await expect(ins({ color: '#ABCDEF' })).rejects.toThrow(/photos_dominant_color_format/);
    await expect(ins({ color: 'red' })).rejects.toThrow(/photos_dominant_color_format/);
    await expect(ins({ alt: 'x'.repeat(301) })).rejects.toThrow(/photos_alt_length/);
    await ins({ color: '#abcdef', alt: 'x'.repeat(300) });
    await db.exec(`delete from public.photos where id = '${id}'`);
  });

  it('url_history status only allows 301 and 410', async () => {
    await expect(db.query(`insert into public.url_history (old_path, status) values ('/s/', 200)`)).rejects.toThrow(
      /url_history_status/,
    );
  });

  it('text length checks on categories and albums', async () => {
    await expect(db.query(`insert into public.categories (slug, name) values ('zz', '')`)).rejects.toThrow(/categories_name_length/);
    await expect(db.query(`insert into public.categories (slug, name) values ('zz', $1)`, ['x'.repeat(81)])).rejects.toThrow(/categories_name_length/);
    await expect(
      db.query(`insert into public.albums (category_id, slug, title) values ($1, 'zz', $2)`, [CAT, 'x'.repeat(121)]),
    ).rejects.toThrow(/albums_title_length/);
  });

  it('RESTRICT: a category with albums and an album with photos cannot be deleted', async () => {
    await expect(db.query(`delete from public.categories where id = '${CAT}'`)).rejects.toThrow(/foreign key/);
    await expect(db.query(`delete from public.albums where id = '${ALB}'`)).rejects.toThrow(/foreign key/);
  });

  it('deleting a cover photo sets cover_photo_id to null (FK on delete set null)', async () => {
    const alb = 'bbbbbbbb-0000-4000-8000-0000000000cc';
    const pho = 'cccccccc-0000-4000-8000-0000000000cc';
    await db.exec(`
      insert into public.albums (id, category_id, slug, title) values ('${alb}', '${CAT}', 'covered', 'C');
      insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total)
        values ('${pho}', '${alb}', 'photos/${pho}/master.jpg', 1, 1, '{}', 0);
      update public.albums set cover_photo_id = '${pho}' where id = '${alb}';
    `);
    await db.exec(`delete from public.photos where id = '${pho}'`);
    const r = await db.query<{ cover_photo_id: string | null }>(`select cover_photo_id from public.albums where id = '${alb}'`);
    expect(r.rows[0].cover_photo_id).toBeNull();
    await db.exec(`delete from public.albums where id = '${alb}'`);
  });
});

describe('migration B: drift guard against DB_COLUMNS', () => {
  for (const t of TABLES) {
    it(`${t} columns equal DB_COLUMNS`, async () => {
      const r = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`,
        [t],
      );
      expect(r.rows.map((x) => x.column_name)).toEqual([...DB_COLUMNS[t]]);
    });
  }
});
