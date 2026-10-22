// Fixture generator, part 1: packages/shared/fixtures/legacy-photos.json
// Reads legacy/fotky_web (read-only) and writes one {legacyKey, width, height, bytes} entry per photo.
// Deterministic: fixed album order, numeric file order, no timestamps.
// Usage: npm run fixtures   (or: npx tsx scripts/gen-fixtures.ts)
// Part 2 (below) also writes supabase/seed.sql and packages/shared/fixtures/snapshot.fixture.json.
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AlbumRow, CategoryRow, PhotoRow, UrlHistoryRow } from '../packages/shared/src/db';
import { masterKey } from '../packages/shared/src/keys';
import { LEGACY_ALBUMS, LEGACY_CATEGORIES, legacyKey, legacyKeysOf } from '../packages/shared/src/legacy/albums';
import { buildSnapshot, type Snapshot } from '../packages/shared/src/snapshot';
import {
  JPEG_1600_BYTES_PER_PIXEL,
  MASTER_JPEG_BYTES_PER_PIXEL,
  MASTER_MAX_EDGE,
  OG_JPEG_BYTES_PER_PIXEL,
  WEBP_BYTES_PER_PIXEL,
  fitWithin,
  sumBytes,
  variantPlan,
  type PhotoVariants,
  type Size,
} from '../packages/shared/src/variants';

export interface LegacyPhotoEntry {
  legacyKey: string;
  width: number;
  height: number;
  bytes: number;
}

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..');
export const LEGACY_GALLERIES_DIR = join(REPO_ROOT, 'legacy', 'fotky_web', 'galleries');
export const LEGACY_PHOTOS_JSON = join(REPO_ROOT, 'packages', 'shared', 'fixtures', 'legacy-photos.json');

/** Same SOF-marker walk as scripts/audit-images.mjs. */
export function jpegSize(buf: Uint8Array): { w: number; h: number } | null {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    let marker = buf[i + 1]!;
    while (marker === 0xff) {
      i++;
      marker = buf[i + 1]!;
    }
    i += 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const len = view.getUint16(i);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { w: view.getUint16(i + 5), h: view.getUint16(i + 3) };
    i += len;
  }
  return null;
}

/** One entry per legacy photo, album order then file number. Throws on a missing or unreadable file. */
export function readLegacyPhotos(galleriesDir: string = LEGACY_GALLERIES_DIR): LegacyPhotoEntry[] {
  const out: LegacyPhotoEntry[] = [];
  for (const album of LEGACY_ALBUMS) {
    for (const key of legacyKeysOf(album)) {
      const file = join(galleriesDir, ...key.split('/'));
      const buf = readFileSync(file);
      const dim = jpegSize(buf);
      if (!dim) throw new Error(`Cannot read JPEG size: ${key}`);
      out.push({ legacyKey: key, width: dim.w, height: dim.h, bytes: statSync(file).size });
    }
  }
  return out;
}

export function serializeLegacyPhotos(entries: LegacyPhotoEntry[]): string {
  return JSON.stringify(entries, null, 2) + '\n';
}

export function writeLegacyPhotos(target: string = LEGACY_PHOTOS_JSON): LegacyPhotoEntry[] {
  const entries = readLegacyPhotos();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, serializeLegacyPhotos(entries));
  return entries;
}

// ---------------------------------------------------------------------------------------------
// Part 2: supabase/seed.sql and packages/shared/fixtures/snapshot.fixture.json.
// One set of rows (buildSeedRows) feeds both, so they cannot drift. Ids are UUIDv5-style, derived
// from fixed names with node:crypto; they are used only here (the live migration lets the DB or
// Worker generate ids). Nothing is random and no clock is read.
// ---------------------------------------------------------------------------------------------

export const SEED_SQL = join(REPO_ROOT, 'supabase', 'seed.sql');
export const SNAPSHOT_FIXTURE_JSON = join(REPO_ROOT, 'packages', 'shared', 'fixtures', 'snapshot.fixture.json');

/** Fixed namespace for every generated id. Never change it: ids in the seed and fixture depend on it. */
export const FIXTURE_NAMESPACE = '6f1d3a52-8c0e-5b7a-9d41-2e6b0c7a9f10';
/** Fixed "now" for the snapshot fixture and placeholder timestamps (the seed uses the database clock). */
export const FIXTURE_NOW = '2026-10-19T00:00:00.000Z';

/** RFC 4122 version 5 UUID (SHA-1) of `name` inside `namespace`. */
export function uuidV5(name: string, namespace: string = FIXTURE_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const h = createHash('sha1').update(ns).update(name, 'utf8').digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface SeedRows {
  categories: CategoryRow[];
  albums: AlbumRow[];
  photos: PhotoRow[];
  urlHistory: UrlHistoryRow[];
}

/** Muted, photo-like colours for the placeholder block of fixture photos (real colours come from the encoder). */
export const FIXTURE_PALETTE = [
  '#8c7b6b', '#a39382', '#6d7a6a', '#7f8f9c', '#b0a090', '#5f6b73', '#9a8478', '#c2b5a5',
  '#74806f', '#8a9aa6', '#a58f7d', '#4f5a52', '#b9a99b', '#6b7886', '#93846f', '#7d6e63',
] as const;

/** Deterministic dominant colour (#rrggbb) for a photo id: SHA-1 of the id picks a palette entry. */
export function fixtureColor(id: string): string {
  const h = createHash('sha1').update(id, 'utf8').digest();
  return FIXTURE_PALETTE[h.readUInt32BE(0) % FIXTURE_PALETTE.length]!;
}

/** Variants for one photo: master via fitWithin, the rest via variantPlan, bytes estimated per file. */
export function variantsFor(sourceW: number, sourceH: number): PhotoVariants {
  const master = fitWithin(sourceW, sourceH, MASTER_MAX_EDGE);
  const plan = variantPlan(master.w, master.h);
  const est = (s: Size, perPixel: number) => Math.ceil(s.w * s.h * perPixel);
  return {
    master: { w: plan.master.w, h: plan.master.h, bytes: est(plan.master, MASTER_JPEG_BYTES_PER_PIXEL) },
    webp: plan.webp.map((e) => ({ tier: e.tier, w: e.w, h: e.h, bytes: est(e, WEBP_BYTES_PER_PIXEL) })) as PhotoVariants['webp'],
    jpeg: { w: plan.jpeg.w, h: plan.jpeg.h, bytes: est(plan.jpeg, JPEG_1600_BYTES_PER_PIXEL) },
    og: { w: plan.og.w, h: plan.og.h, bytes: est(plan.og, OG_JPEG_BYTES_PER_PIXEL) },
  };
}

/** The legacy catalog as database rows (3 categories, 13 published albums, 141 photos, covers from mainImgNum). */
export function buildSeedRows(legacy: LegacyPhotoEntry[]): SeedRows {
  const byKey = new Map(legacy.map((e) => [e.legacyKey, e]));
  const categories: CategoryRow[] = LEGACY_CATEGORIES.map((c) => ({
    id: uuidV5(`category:${c.slug}`),
    slug: c.slug,
    name: c.name,
    description: null,
    seo_title: null,
    seo_description: null,
    sort: c.sort,
    visible: true,
    created_at: FIXTURE_NOW,
    updated_at: FIXTURE_NOW,
  }));
  const catId = new Map(categories.map((c) => [c.slug, c.id]));
  const albums: AlbumRow[] = [];
  const photos: PhotoRow[] = [];
  for (const a of LEGACY_ALBUMS) {
    const albumId = uuidV5(`album:${a.id}`);
    let cover: string | null = null;
    for (let n = 1; n <= a.photoCount; n++) {
      const key = legacyKey(a.legacyCategory, a.id, n);
      const src = byKey.get(key);
      if (!src) throw new Error(`legacy-photos.json has no entry for ${key}`);
      const id = uuidV5(`photo:${key}`);
      const variants = variantsFor(src.width, src.height);
      if (n === a.mainImgNum) cover = id;
      photos.push({
        id,
        album_id: albumId,
        master_key: masterKey(id),
        width: variants.master.w,
        height: variants.master.h,
        variants,
        bytes_total: sumBytes(variants),
        dominant_color: fixtureColor(id),
        alt: null,
        caption: null,
        sort: n * 10,
        legacy_key: key,
        created_at: FIXTURE_NOW,
        updated_at: FIXTURE_NOW,
      });
    }
    albums.push({
      id: albumId,
      category_id: catId.get(a.categorySlug)!,
      slug: a.id,
      title: a.title,
      place: a.place,
      shot_on: null,
      description: null,
      seo_title: null,
      seo_description: null,
      cover_photo_id: cover,
      sort: a.sort,
      published: true,
      legacy_id: a.id,
      created_at: FIXTURE_NOW,
      updated_at: FIXTURE_NOW,
    });
  }
  return { categories, albums, photos, urlHistory: [] };
}

export function readLegacyPhotosJson(file: string = LEGACY_PHOTOS_JSON): LegacyPhotoEntry[] {
  return JSON.parse(readFileSync(file, 'utf8')) as LegacyPhotoEntry[];
}

const q = (s: string | null): string => (s === null ? 'null' : `'${s.replace(/'/g, "''")}'`);

/** seed.sql text. Plain inserts as the database owner; no admin user; ends by resetting the change counter. */
export function renderSeedSql(rows: SeedRows): string {
  const out: string[] = [
    '-- GENERATED by scripts/gen-fixtures.ts (npm run fixtures). Do not edit by hand.',
    '-- The legacy catalog: 3 categories, 13 published albums, 141 photos with planned variants.',
    '-- Runs as the database owner (supabase db reset). Creates no admin user. Never run against live data.',
    '',
    'insert into public.categories (id, slug, name, sort, visible) values',
    rows.categories.map((c) => `  (${q(c.id)}, ${q(c.slug)}, ${q(c.name)}, ${c.sort}, ${c.visible})`).join(',\n') + ';',
    '',
    'insert into public.albums (id, category_id, slug, title, place, sort, published, legacy_id) values',
    rows.albums
      .map(
        (a) =>
          `  (${q(a.id)}, ${q(a.category_id)}, ${q(a.slug)}, ${q(a.title)}, ${q(a.place)}, ${a.sort}, ${a.published}, ${q(a.legacy_id)})`,
      )
      .join(',\n') + ';',
    '',
  ];
  for (const a of rows.albums) {
    out.push(`-- photos of ${a.slug}`);
    out.push('insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total, dominant_color, sort, legacy_key) values');
    out.push(
      rows.photos
        .filter((p) => p.album_id === a.id)
        .map(
          (p) =>
            `  (${q(p.id)}, ${q(p.album_id)}, ${q(p.master_key)}, ${p.width}, ${p.height}, ${q(JSON.stringify(p.variants))}::jsonb, ${p.bytes_total}, ${q(p.dominant_color)}, ${p.sort}, ${q(p.legacy_key)})`,
        )
        .join(',\n') + ';',
    );
    out.push('');
  }
  out.push('-- Covers (main image of each legacy album).');
  for (const a of rows.albums) {
    out.push(`update public.albums set cover_photo_id = ${q(a.cover_photo_id)} where id = ${q(a.id)};`);
  }
  out.push('');
  out.push('-- The seed is not a pending change.');
  out.push('update public.site_state set pending_changes = 0;');
  return out.join('\n') + '\n';
}

/** The snapshot built from the same rows with the fixed clock. */
export function buildSnapshotFixture(rows: SeedRows): Snapshot {
  return buildSnapshot(rows, new Date(FIXTURE_NOW));
}

export function serializeSnapshot(s: Snapshot): string {
  return JSON.stringify(s, null, 2) + '\n';
}

/** Regenerates both files in memory from legacy-photos.json (no disk reads of legacy/). */
export function renderPart2(legacy: LegacyPhotoEntry[] = readLegacyPhotosJson()): { seedSql: string; snapshotJson: string; rows: SeedRows } {
  const rows = buildSeedRows(legacy);
  return { seedSql: renderSeedSql(rows), snapshotJson: serializeSnapshot(buildSnapshotFixture(rows)), rows };
}

export function writePart2(legacy: LegacyPhotoEntry[] = readLegacyPhotosJson()): void {
  const { seedSql, snapshotJson } = renderPart2(legacy);
  mkdirSync(dirname(SEED_SQL), { recursive: true });
  writeFileSync(SEED_SQL, seedSql);
  writeFileSync(SNAPSHOT_FIXTURE_JSON, snapshotJson);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const entries = writeLegacyPhotos();
  const total = entries.reduce((s, e) => s + e.bytes, 0);
  console.log(`wrote ${entries.length} entries (${total} bytes of source jpgs) to ${LEGACY_PHOTOS_JSON}`);
  writePart2(entries);
  console.log(`wrote ${SEED_SQL} and ${SNAPSHOT_FIXTURE_JSON}`);
}
