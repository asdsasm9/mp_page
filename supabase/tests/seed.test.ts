import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LEGACY_ALBUMS } from '../../packages/shared/src/legacy/albums';
import { buildSnapshot, SnapshotSchema, type Snapshot } from '../../packages/shared/src/snapshot';
import type { AlbumRow, CategoryRow, PhotoRow, UrlHistoryRow } from '../../packages/shared/src/db';
import { SEED_SQL, SNAPSHOT_FIXTURE_JSON } from '../../scripts/gen-fixtures';
import { asRole, createMigratedDb, seedAdmin } from './helpers/db';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const here = dirname(fileURLToPath(import.meta.url));
const mappingDoc = readFileSync(join(here, '..', '..', 'docs', 'CONTENT-MAPPING.md'), 'utf8');
const fixture = JSON.parse(readFileSync(SNAPSHOT_FIXTURE_JSON, 'utf8')) as Snapshot;

let db: PGlite;

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(readFileSync(SEED_SQL, 'utf8'));
});

afterAll(async () => {
  await db.close();
});

const count = async (table: string) =>
  (await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`)).rows[0].n;

describe('seed.sql on a freshly migrated database', () => {
  it('loads 3 categories, 13 albums and 141 photos', async () => {
    expect(await count('categories')).toBe(3);
    expect(await count('albums')).toBe(13);
    expect(await count('photos')).toBe(141);
    expect(await count('url_history')).toBe(0);
  });

  it('per-album photo counts match docs/CONTENT-MAPPING.md', async () => {
    const r = await db.query<{ slug: string; n: number }>(
      `select a.slug, count(p.id)::int as n from public.albums a
         left join public.photos p on p.album_id = a.id group by a.slug`,
    );
    const got = Object.fromEntries(r.rows.map((x) => [x.slug, x.n]));
    for (const a of LEGACY_ALBUMS) {
      expect(got[a.id], a.id).toBe(a.photoCount);
      // Table row: | n | id | category | title | place | photos | cover | sort |
      expect(mappingDoc, `${a.id} in CONTENT-MAPPING.md`).toMatch(
        new RegExp(`^\\|\\s*\\d+\\s*\\|\\s*${a.id}\\s*\\|[^|]*\\|[^|]*\\|[^|]*\\|\\s*${a.photoCount}\\s*\\|\\s*${a.mainImgNum}\\s*\\|`, 'm'),
      );
    }
    expect(r.rows.length).toBe(13);
  });

  it('covers are the mainImgNum photos', async () => {
    const r = await db.query<{ slug: string; legacy_key: string }>(
      `select a.slug, p.legacy_key from public.albums a join public.photos p on p.id = a.cover_photo_id`,
    );
    const got = Object.fromEntries(r.rows.map((x) => [x.slug, x.legacy_key]));
    for (const a of LEGACY_ALBUMS) {
      expect(got[a.id], a.id).toBe(`${a.legacyCategory}/${a.id}/${a.mainImgNum}.jpg`);
    }
  });

  it('the seed is not counted as a pending change', async () => {
    const r = await db.query<{ n: number }>('select pending_changes as n from public.site_state');
    expect(r.rows[0].n).toBe(0);
  });

  it('storage_usage().used_bytes equals the sum in the fixture', async () => {
    await seedAdmin(db, ADMIN, 'a@example.test');
    const usage = await asRole(
      db,
      'authenticated',
      async (d) => (await d.query<{ u: { used_bytes: number; photo_count: number; level: string } }>('select public.storage_usage() as u')).rows[0].u,
      ADMIN,
    );
    const fixtureSum = fixture.categories
      .flatMap((c) => c.albums)
      .flatMap((a) => a.photos)
      .reduce((s, p) => s + p.variants.master.bytes + p.variants.webp.reduce((x, w) => x + w.bytes, 0) + p.variants.jpeg.bytes + p.variants.og.bytes, 0);
    expect(Number(usage.used_bytes)).toBe(fixtureSum);
    expect(usage.photo_count).toBe(141);
    expect(usage.level).toBe('ok');
  });

  it('buildSnapshot over rows read back from the DB deep-equals the committed fixture (ignoring generatedAt)', async () => {
    const categories = (
      await db.query<CategoryRow>(
        `select id, slug, name, description, seo_title, seo_description, sort, visible, cover_photo_id,
                created_at::text, updated_at::text from public.categories`,
      )
    ).rows;
    const albums = (
      await db.query<AlbumRow>(
        `select id, category_id, slug, title, place, shot_on::text as shot_on, description, seo_title,
                seo_description, cover_photo_id, sort, published, legacy_id, created_at::text, updated_at::text
           from public.albums`,
      )
    ).rows;
    const photos = (
      await db.query<PhotoRow>(
        `select id, album_id, master_key, width, height, variants, bytes_total::float8 as bytes_total,
                dominant_color, alt, caption, sort, legacy_key, created_at::text, updated_at::text
           from public.photos`,
      )
    ).rows;
    const urlHistory = (
      await db.query<UrlHistoryRow>('select id, old_path, target, status, created_at::text from public.url_history')
    ).rows;

    const fromDb = buildSnapshot({ categories, albums, photos, urlHistory }, new Date(fixture.generatedAt));
    expect(SnapshotSchema.safeParse(fromDb).success).toBe(true);
    // The seed rows take the database clock, so updatedAt (derived from row timestamps) cannot match
    // the fixture's fixed clock. It is checked separately: every value is a valid ISO date-time.
    const strip = (s: Snapshot) =>
      JSON.parse(JSON.stringify(s, (k, v: unknown) => (k === 'updatedAt' || k === 'generatedAt' ? undefined : v)));
    expect(strip(fromDb)).toEqual(strip(fixture));
    for (const c of fromDb.categories) {
      expect(c.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
      for (const a of c.albums) expect(a.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    }
  });

  it('a second fresh database also loads the seed', async () => {
    const other = await createMigratedDb();
    try {
      await other.exec(readFileSync(SEED_SQL, 'utf8'));
      const r = await other.query<{ n: number }>('select count(*)::int as n from public.photos');
      expect(r.rows[0].n).toBe(141);
    } finally {
      await other.close();
    }
  });
});
