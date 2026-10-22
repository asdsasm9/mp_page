// Source discovery and identity for the legacy migration (plan WP-06 sections 3.4 and 7 step 3).
// Reads nothing but file metadata: which legacy files exist, and which stable id each one gets.
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGACY_ALBUMS, legacyKeysOf, type LegacyAlbum } from '../../packages/shared/src/legacy/albums';
import { uuidV5 } from '../gen-fixtures';

/** Dedicated namespace of the migration ids. Never change it: committed photo ids depend on it. Differs from FIXTURE_NAMESPACE on purpose. */
export const MIGRATION_NAMESPACE = 'b3c8e0a4-52d7-5f19-8a6c-47e1d90b2c35';

/** Default location of the legacy files, relative to the repo root (read-only). */
export const GALLERIES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'legacy', 'fotky_web', 'galleries');

/** Stable id of a photo: UUIDv5 of its legacy key in the migration namespace. */
export function photoIdOf(legacyKey: string): string {
  return uuidV5(`photo:${legacyKey}`, MIGRATION_NAMESPACE);
}

export class SourcePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourcePathError';
  }
}

const KEY_RE = /^(weddings|portraits|couples)\/[a-z0-9_]+\/[1-9][0-9]*\.jpg$/;

/** Resolves a legacy key under galleriesDir. Anything that is not a plain key or escapes the directory is a hard error. */
export function resolveSourcePath(galleriesDir: string, legacyKey: string): string {
  if (!KEY_RE.test(legacyKey)) throw new SourcePathError(`illegal legacy key: ${legacyKey}`);
  const root = resolve(galleriesDir);
  const full = resolve(join(root, ...legacyKey.split('/')));
  if (!full.startsWith(root + sep)) throw new SourcePathError(`path outside galleries: ${legacyKey}`);
  return full;
}

export interface SourcePhoto {
  legacyKey: string;
  /** File number, 1..photoCount (also the order). */
  n: number;
  id: string;
  path: string;
  exists: boolean;
}

export interface SourceAlbum {
  album: LegacyAlbum;
  photos: SourcePhoto[];
}

export interface DiscoverOptions {
  galleriesDir?: string;
  /** Only this legacy album id. */
  album?: string | null;
  /** Injectable for tests; defaults to fs.existsSync. */
  exists?: (path: string) => boolean;
}

export interface Discovery {
  albums: SourceAlbum[];
  total: number;
  missing: string[];
}

/** The planned sources in album order, then file number. Unknown album ids are an error. */
export function discoverSources(opts: DiscoverOptions = {}): Discovery {
  const dir = opts.galleriesDir ?? GALLERIES_DIR;
  const exists = opts.exists ?? existsSync;
  const only = opts.album ?? null;
  if (only !== null && !LEGACY_ALBUMS.some((a) => a.id === only)) {
    throw new SourcePathError(`unknown album: ${only}`);
  }
  const albums: SourceAlbum[] = [];
  const missing: string[] = [];
  for (const album of LEGACY_ALBUMS) {
    if (only !== null && album.id !== only) continue;
    const photos = legacyKeysOf(album).map((legacyKey, i): SourcePhoto => {
      const path = resolveSourcePath(dir, legacyKey);
      const ok = exists(path);
      if (!ok) missing.push(legacyKey);
      return { legacyKey, n: i + 1, id: photoIdOf(legacyKey), path, exists: ok };
    });
    albums.push({ album, photos });
  }
  return { albums, total: albums.reduce((s, a) => s + a.photos.length, 0), missing };
}
