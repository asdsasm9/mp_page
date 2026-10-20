// Dev images for fixture mode (plan WP3-6): generates the variants the snapshot fixture refers to into
// apps/web/public/_dev-img/photos/<id>/..., from legacy/fotky_web/galleries/ (read-only), so the local site,
// design-check and weight tests have real pixels. The output is gitignored and a production build refuses
// to ship it (assertProductionOutput). A fixture photo whose source file is missing gets a solid
// dominant-colour image of the right size. Idempotent: existing files are kept (use --force to rebuild).
// Usage: npm run dev-images
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { jpegKey, ogKey, webpKey, type WebpTier } from '../packages/shared/src/keys';
import { LEGACY_ALBUMS, legacyKeysOf } from '../packages/shared/src/legacy/albums';
import { SnapshotSchema, type Snapshot } from '../packages/shared/src/snapshot';
import { variantPlan, type PhotoVariants } from '../packages/shared/src/variants';
import { dominantColorOf } from './dominant-color';
import { uuidV5 } from './gen-fixtures';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..');
export const GALLERIES_DIR = join(REPO_ROOT, 'legacy', 'fotky_web', 'galleries');
export const DEV_IMG_OUT = join(REPO_ROOT, 'apps', 'web', 'public', '_dev-img');
export const SNAPSHOT_FIXTURE = join(REPO_ROOT, 'packages', 'shared', 'fixtures', 'snapshot.fixture.json');

/** Neutral grey used when a photo has no dominant colour (same value as the --color-placeholder token). */
export const FALLBACK_COLOR = '#e6e6e6';

export interface DevPhoto {
  id: string;
  /** Path below the galleries directory, e.g. weddings/sedlakovi/12.jpg; null when unknown. */
  legacyKey: string | null;
  variants: Pick<PhotoVariants, 'master' | 'webp' | 'jpeg' | 'og'>;
  dominantColor: string | null;
}

export interface DevImageRow {
  id: string;
  files: number;
  created: number;
  placeholder: boolean;
  /** Colour computed from the generated image (null when nothing was generated this run). */
  color: string | null;
}

/** Maps fixture photo ids to their legacy file (the ids are UUIDv5 of the legacy key, see gen-fixtures). */
export function legacyKeyById(): Map<string, string> {
  const map = new Map<string, string>();
  for (const album of LEGACY_ALBUMS) {
    for (const key of legacyKeysOf(album)) map.set(uuidV5(`photo:${key}`), key);
  }
  return map;
}

export function devPhotosFromSnapshot(snapshot: Snapshot): DevPhoto[] {
  const byId = legacyKeyById();
  const out: DevPhoto[] = [];
  for (const c of snapshot.categories) {
    for (const a of c.albums) {
      for (const p of a.photos) {
        out.push({ id: p.id, legacyKey: byId.get(p.id) ?? null, variants: p.variants, dominantColor: p.dominantColor });
      }
    }
  }
  return out;
}

/** Every key of a photo that the public site can request, relative to the image base (no master). */
export function publicKeys(photo: DevPhoto): Array<{ key: string; kind: 'webp' | 'jpeg' | 'og'; w: number; h: number }> {
  return [
    ...photo.variants.webp.map((v) => ({ key: webpKey(photo.id, v.tier as WebpTier), kind: 'webp' as const, w: v.w, h: v.h })),
    { key: jpegKey(photo.id), kind: 'jpeg' as const, w: photo.variants.jpeg.w, h: photo.variants.jpeg.h },
    { key: ogKey(photo.id), kind: 'og' as const, w: photo.variants.og.w, h: photo.variants.og.h },
  ];
}

// dominantColorOf lives in ./dominant-color (shared with migrate-legacy); re-exported for existing importers.
export { dominantColorOf };

/**
 * The master-sized dev copy of a source file. It is always re-encoded by sharp, which drops EXIF/GPS/ICC
 * metadata unless asked to keep it (never do that here: the master is publicly linked, see T-114).
 */
export async function devMasterOf(source: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(source).rotate().resize({ width, height, fit: 'fill' }).toBuffer();
}

/** True when an image buffer carries an EXIF block (camera data, GPS). Used by the master privacy test. */
export async function hasExif(image: Buffer): Promise<boolean> {
  const meta = await sharp(image).metadata();
  return meta.exif !== undefined && meta.exif.length > 0;
}

export async function generateDevImages(
  photos: DevPhoto[],
  { galleriesDir = GALLERIES_DIR, outDir = DEV_IMG_OUT, force = false } = {},
): Promise<DevImageRow[]> {
  const rows: DevImageRow[] = [];
  for (const photo of photos) {
    const keys = publicKeys(photo);
    const missing = keys.filter((k) => force || !existsSync(join(outDir, ...k.key.split('/'))));
    const source = photo.legacyKey ? join(galleriesDir, ...photo.legacyKey.split('/')) : null;
    const hasSource = source !== null && existsSync(source);
    let color: string | null = photo.dominantColor;
    if (missing.length > 0) {
      mkdirSync(join(outDir, 'photos', photo.id), { recursive: true });
      const { master } = photo.variants;
      const plan = variantPlan(master.w, master.h);
      // Master-sized copy first (sharp applies extract before resize inside one pipeline).
      const masterBuf = hasSource ? await devMasterOf(readFileSync(source), master.w, master.h) : null;
      if (masterBuf) color = await dominantColorOf(masterBuf);
      for (const k of missing) {
        const target = join(outDir, ...k.key.split('/'));
        let pipe: ReturnType<typeof sharp>;
        if (masterBuf) {
          pipe = sharp(masterBuf);
          if (k.kind === 'og') pipe = pipe.extract({ left: plan.og.crop.x, top: plan.og.crop.y, width: plan.og.crop.w, height: plan.og.crop.h });
          pipe = pipe.resize({ width: k.w, height: k.h, fit: 'fill' });
        } else {
          pipe = sharp({ create: { width: k.w, height: k.h, channels: 3, background: photo.dominantColor ?? FALLBACK_COLOR } });
        }
        if (k.kind === 'webp') await pipe.webp({ quality: 70 }).toFile(target);
        else await pipe.jpeg({ quality: 75, mozjpeg: true }).toFile(target);
      }
    }
    rows.push({ id: photo.id, files: keys.length, created: missing.length, placeholder: !hasSource, color });
  }
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const snapshot = SnapshotSchema.parse(JSON.parse(readFileSync(SNAPSHOT_FIXTURE, 'utf8')));
  const photos = devPhotosFromSnapshot(snapshot);
  const rows = await generateDevImages(photos, { force: process.argv.includes('--force') });
  const created = rows.reduce((a, r) => a + r.created, 0);
  const placeholders = rows.filter((r) => r.placeholder).length;
  console.log(`${rows.length} photos, ${created} files created, ${placeholders} placeholders, output ${DEV_IMG_OUT}`);
}
