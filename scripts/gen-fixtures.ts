// Fixture generator, part 1: packages/shared/fixtures/legacy-photos.json
// Reads legacy/fotky_web (read-only) and writes one {legacyKey, width, height, bytes} entry per photo.
// Deterministic: fixed album order, numeric file order, no timestamps.
// Usage: npm run fixtures   (or: npx tsx scripts/gen-fixtures.ts)
import { readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LEGACY_ALBUMS, legacyKeysOf } from '../packages/shared/src/legacy/albums';

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const entries = writeLegacyPhotos();
  const total = entries.reduce((s, e) => s + e.bytes, 0);
  console.log(`wrote ${entries.length} entries (${total} bytes of source jpgs) to ${LEGACY_PHOTOS_JSON}`);
}
