/**
 * Snapshot service (WP-4 section 4.7, /publish steps 2 to 4). Reads every catalog table under the
 * caller's JWT (paged), builds the public snapshot with the shared `buildSnapshot` (which carries the
 * `updatedAt` timestamps), refuses an empty one, then writes `catalog/published.json` to the public
 * bucket with `Cache-Control: no-cache`. Nothing is written when the snapshot is empty or a read fails.
 * There are no backups (D-17): the public bucket holds only photos and the published snapshot.
 *
 * Failures throw: `SnapshotEmptyError` (code SNAPSHOT_EMPTY) from `assertPublishable`, and
 * `PublishServiceError` carrying a Worker error code for a failed read or write. Neither message
 * contains input, URLs or tokens.
 */
import {
  SNAPSHOT_KEY,
  assertPublishable,
  buildSnapshot,
  type AlbumRow,
  type CategoryRow,
  type PhotoRow,
  type SiteSettingsRow,
  type Snapshot,
  type StorageAdapter,
  type UrlHistoryRow,
  type WorkerErrorCode,
} from '@mp/shared';
import type { SupabaseClient } from './supabase';

export const SNAPSHOT_CACHE_CONTROL = 'no-cache';

export class PublishServiceError extends Error {
  constructor(readonly code: WorkerErrorCode) {
    super(code);
    this.name = 'PublishServiceError';
  }
}

export interface CatalogRows {
  categories: CategoryRow[];
  albums: AlbumRow[];
  photos: PhotoRow[];
  urlHistory: UrlHistoryRow[];
  siteSettings?: SiteSettingsRow | null;
}

export interface PublishServiceDeps {
  supabase: SupabaseClient;
  /** Public bucket (snapshot). */
  publicBucket: StorageAdapter;
  now: () => Date;
}

export interface SnapshotResult {
  snapshot: Snapshot;
  snapshotBytes: number;
  counts: Snapshot['counts'];
}

/** Reads all catalog tables, in a stable order, walking pages. */
export async function loadCatalogRows(supabase: SupabaseClient, jwt: string): Promise<CatalogRows> {
  const read = async <T>(table: string): Promise<T[]> => {
    const res = await supabase.select<T>(table, { select: '*', order: 'id.asc' }, jwt);
    if (!res.ok) throw new PublishServiceError(res.code);
    return res.data;
  };
  const categories = await read<CategoryRow>('categories');
  const albums = await read<AlbumRow>('albums');
  const photos = await read<PhotoRow>('photos');
  const urlHistory = await read<UrlHistoryRow>('url_history');
  // A missing table (HTTP 404, e.g. 42P01 / PGRST205: migration not applied yet) or no row means "no hero chosen".
  // Any other failure (5xx, network error, timeout) fails the publish so a chosen hero is never silently dropped.
  const settings = await supabase.select<SiteSettingsRow>('site_settings', { select: '*', order: 'id.asc' }, jwt);
  if (!settings.ok && settings.status !== 404) throw new PublishServiceError(settings.code);
  const siteSettings = settings.ok ? (settings.data[0] ?? null) : null;
  return { categories, albums, photos, urlHistory, siteSettings };
}

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

export async function buildAndStoreSnapshot(deps: PublishServiceDeps, jwt: string): Promise<SnapshotResult> {
  const rows = await loadCatalogRows(deps.supabase, jwt);
  const snapshot = buildSnapshot(rows, deps.now());
  assertPublishable(snapshot);

  const snapshotBody = encode(snapshot);
  try {
    await deps.publicBucket.put(SNAPSHOT_KEY, snapshotBody, {
      contentType: 'application/json',
      cacheControl: SNAPSHOT_CACHE_CONTROL,
    });
  } catch {
    throw new PublishServiceError('UPSTREAM_ERROR');
  }
  return { snapshot, snapshotBytes: snapshotBody.byteLength, counts: snapshot.counts };
}
