/**
 * Catalog loader (plan WP-3, section 4.1). Loads the snapshot (committed fixture, or fetched at build
 * time), validates it, and builds the indexes the pages use. Any failure throws, so the build fails and
 * the previous deploy stays live (MASTERPLAN section 4).
 */
import {
  SnapshotSchema,
  assertPublishable,
  type Snapshot,
  type SnapshotAlbum,
  type SnapshotCategory,
  type SnapshotPhoto,
} from '@mp/shared';
import fixtureJson from '../../../../packages/shared/fixtures/snapshot.fixture.json';
import { BuildConfigError, type WebEnv } from './env';

export const FETCH_TIMEOUT_MS = 15_000;
export const FETCH_RETRIES = 3;
const BACKOFF_BASE_MS = 500;

export class CatalogLoadError extends Error {
  readonly code = 'CATALOG_LOAD' as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CatalogLoadError';
  }
}

export interface LoadOptions {
  fetch?: typeof fetch;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** Retries after the first attempt (so 3 means up to 4 attempts). */
  retries?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class Retryable extends Error {}

async function fetchOnce(url: string, doFetch: typeof fetch, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Retryable(`timeout after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    const run = (async () => {
      let res: Response;
      try {
        res = await doFetch(url, { cache: 'no-store', redirect: 'error', signal: controller.signal });
      } catch (e) {
        throw new Retryable(`network error: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (res.status >= 500 || res.status === 429) throw new Retryable(`HTTP ${res.status}`);
      if (!res.ok) throw new CatalogLoadError(`snapshot request failed with HTTP ${res.status}`);
      return await res.text();
    })();
    run.catch(() => undefined); // a late failure after a timeout must not become an unhandled rejection
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Parses and validates snapshot JSON text. Throws CatalogLoadError on any problem. */
export function parseSnapshotText(text: string): Snapshot {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new CatalogLoadError('snapshot is not valid JSON');
  }
  return validateSnapshot(json);
}

export function validateSnapshot(json: unknown): Snapshot {
  const parsed = SnapshotSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new CatalogLoadError(
      `snapshot failed validation: ${first ? `${first.path.join('.')}: ${first.message}` : 'unknown issue'}`,
    );
  }
  try {
    assertPublishable(parsed.data);
  } catch (e) {
    throw new CatalogLoadError('snapshot has no published album (SNAPSHOT_EMPTY)', { cause: e });
  }
  return parsed.data;
}

/** Fixture mode reads the committed fixture; snapshot mode fetches `env.snapshotUrl`. Throws on any failure. */
export async function loadSnapshot(env: WebEnv, options: LoadOptions = {}): Promise<Snapshot> {
  if (env.source === 'fixture') return validateSnapshot(fixtureJson);
  if (env.snapshotUrl === null) throw new BuildConfigError('snapshot mode without a snapshot URL');
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const retries = options.retries ?? FETCH_RETRIES;

  let lastReason = 'unknown';
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return parseSnapshotText(await fetchOnce(env.snapshotUrl, doFetch, timeoutMs));
    } catch (e) {
      if (!(e instanceof Retryable)) throw e;
      lastReason = e.message;
      if (attempt < retries) await sleep(BACKOFF_BASE_MS * 2 ** attempt);
    }
  }
  throw new CatalogLoadError(`snapshot could not be loaded after ${retries + 1} attempts: ${lastReason}`);
}

// ------------------------------------------------------------------ indexes

export interface AlbumEntry {
  category: SnapshotCategory;
  album: SnapshotAlbum;
  /** Position inside the category. */
  index: number;
}

export interface PhotoEntry {
  category: SnapshotCategory;
  album: SnapshotAlbum;
  photo: SnapshotPhoto;
  /** Position inside the album, 0-based. */
  index: number;
}

export interface Catalog {
  snapshot: Snapshot;
  /** Categories that have at least one published album, in snapshot order. */
  categories: SnapshotCategory[];
  categoryBySlug: ReadonlyMap<string, SnapshotCategory>;
  albumBySlug: ReadonlyMap<string, AlbumEntry>;
  photoById: ReadonlyMap<string, PhotoEntry>;
  /** Previous and next album inside the same category (null at the ends, no wrap-around). */
  neighbours(albumSlug: string): { prev: SnapshotAlbum | null; next: SnapshotAlbum | null };
  /** The cover photo of an album (falls back to the first photo; null for an album without photos). */
  coverOf(album: SnapshotAlbum): SnapshotPhoto | null;
  /** The category's chosen main photo, else the cover of its first album (null for a category without photos). */
  categoryCover(category: SnapshotCategory): SnapshotPhoto | null;
  /** The photo chosen for the home hero, or null (nothing chosen, or the photo is not in this catalog): use the bundled image. */
  heroPhoto(): SnapshotPhoto | null;
}

export function buildCatalog(snapshot: Snapshot): Catalog {
  const categories = snapshot.categories.filter((c) => c.albums.length > 0);
  const categoryBySlug = new Map<string, SnapshotCategory>();
  const albumBySlug = new Map<string, AlbumEntry>();
  const photoById = new Map<string, PhotoEntry>();
  for (const category of categories) {
    categoryBySlug.set(category.slug, category);
    category.albums.forEach((album, index) => {
      albumBySlug.set(album.slug, { category, album, index });
      album.photos.forEach((photo, pi) => photoById.set(photo.id, { category, album, photo, index: pi }));
    });
  }
  const coverOf = (album: SnapshotAlbum): SnapshotPhoto | null =>
    album.photos.find((p) => p.id === album.coverPhotoId) ?? album.photos[0] ?? null;
  return {
    snapshot,
    categories,
    categoryBySlug,
    albumBySlug,
    photoById,
    neighbours(albumSlug) {
      const entry = albumBySlug.get(albumSlug);
      if (!entry) return { prev: null, next: null };
      const list = entry.category.albums;
      return { prev: list[entry.index - 1] ?? null, next: list[entry.index + 1] ?? null };
    },
    coverOf,
    categoryCover(category) {
      if (category.coverPhotoId !== null) {
        for (const album of category.albums) {
          const chosen = album.photos.find((p) => p.id === category.coverPhotoId);
          if (chosen) return chosen;
        }
      }
      const first = category.albums[0];
      return first ? coverOf(first) : null;
    },
    heroPhoto() {
      return snapshot.heroPhotoId === null ? null : (photoById.get(snapshot.heroPhotoId)?.photo ?? null);
    },
  };
}

let cached: Promise<Catalog> | undefined;

/** The catalog for the current build, loaded once per process. Pages call this from frontmatter. */
export function getCatalog(env: WebEnv, options?: LoadOptions): Promise<Catalog> {
  cached ??= loadSnapshot(env, options).then(buildCatalog);
  return cached;
}
