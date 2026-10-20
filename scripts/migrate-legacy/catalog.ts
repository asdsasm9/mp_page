// Catalog phase of the live migration (plan WP-06 3.4, step 8): 3 categories and 13 albums through the backend.
// Creates what is missing, never touches what exists. An existing row whose values differ from CONTENT-MAPPING
// (title/place/sort/category, name/sort) is reported as drift and left exactly as it is.
import { LEGACY_ALBUMS, LEGACY_CATEGORIES } from '../../packages/shared/src/legacy/albums';
import { uuidV5 } from '../gen-fixtures';
import type { AlbumInput, CategoryInput, MigrationBackend } from './backend';
import { MIGRATION_NAMESPACE } from './sources';
import type { MigrateOptions } from './types';

export const categoryIdOf = (slug: string): string => uuidV5(`category:${slug}`, MIGRATION_NAMESPACE);
export const albumIdOf = (legacyId: string): string => uuidV5(`album:${legacyId}`, MIGRATION_NAMESPACE);

export interface Drift {
  kind: 'category' | 'album';
  /** Category slug or legacy album id. */
  ref: string;
  field: string;
  expected: string | number | null;
  actual: string | number | null;
}

export interface CatalogReport {
  categoriesCreated: number;
  categoriesExisting: number;
  albumsCreated: number;
  albumsExisting: number;
  drift: Drift[];
  /** Stored album id by legacy album id (existing or created), for the photo phase. */
  albumIds: Record<string, string>;
}

/** Upserts the categories and albums in scope (`--album` limits to one album and its category). */
export async function syncCatalog(backend: MigrationBackend, options: Pick<MigrateOptions, 'album'>): Promise<CatalogReport> {
  const albums = LEGACY_ALBUMS.filter((a) => options.album === null || a.id === options.album);
  const slugs = new Set(albums.map((a) => a.categorySlug));
  const report: CatalogReport = { categoriesCreated: 0, categoriesExisting: 0, albumsCreated: 0, albumsExisting: 0, drift: [], albumIds: {} };

  const knownCategories = new Set((await backend.listCategories()).map((c) => c.slug));
  const categoryIds = new Map<string, string>();
  for (const c of LEGACY_CATEGORIES.filter((x) => slugs.has(x.slug))) {
    const input: CategoryInput = { id: categoryIdOf(c.slug), slug: c.slug, name: c.name, sort: c.sort };
    const row = await backend.upsertCategory(input);
    categoryIds.set(c.slug, row.id);
    if (knownCategories.has(c.slug)) {
      report.categoriesExisting++;
      if (row.name !== c.name) report.drift.push({ kind: 'category', ref: c.slug, field: 'name', expected: c.name, actual: row.name });
      if (row.sort !== c.sort) report.drift.push({ kind: 'category', ref: c.slug, field: 'sort', expected: c.sort, actual: row.sort });
    } else {
      report.categoriesCreated++;
    }
  }

  const knownAlbums = new Set((await backend.listAlbums()).map((a) => a.legacy_id));
  for (const a of albums) {
    const categoryId = categoryIds.get(a.categorySlug)!;
    const input: AlbumInput = {
      id: albumIdOf(a.id),
      category_id: categoryId,
      slug: a.id,
      title: a.title,
      place: a.place,
      sort: a.sort,
      legacy_id: a.id,
      published: true,
    };
    const row = await backend.upsertAlbum(input);
    report.albumIds[a.id] = row.id;
    if (!knownAlbums.has(a.id)) {
      report.albumsCreated++;
      continue;
    }
    report.albumsExisting++;
    const check = (field: string, expected: string | number | null, actual: string | number | null) => {
      if (expected !== actual) report.drift.push({ kind: 'album', ref: a.id, field, expected, actual });
    };
    check('title', a.title, row.title);
    check('place', a.place, row.place);
    check('sort', a.sort, row.sort);
    check('category_id', categoryId, row.category_id);
  }
  return report;
}

export function formatCatalog(r: CatalogReport): string[] {
  const lines = [
    `catalog: categories created ${r.categoriesCreated} existing ${r.categoriesExisting}, albums created ${r.albumsCreated} existing ${r.albumsExisting}, drift ${r.drift.length}`,
  ];
  for (const d of r.drift) lines.push(`  DRIFT ${d.kind} ${d.ref} ${d.field}: expected ${JSON.stringify(d.expected)}, found ${JSON.stringify(d.actual)} (left unchanged)`);
  return lines;
}
