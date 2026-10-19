/**
 * Snapshot and backup service (WP-4 section 4.7, /publish steps 2 to 5). Reads every catalog table
 * under the caller's JWT (paged), builds the public snapshot with the shared `buildSnapshot` (which
 * carries the `updatedAt` timestamps), refuses an empty one, writes the full backup (drafts included)
 * to the private bucket and prunes it, then writes `catalog/published.json` to the public bucket
 * with `Cache-Control: no-cache`. Nothing is written when the snapshot is empty or a read fails.
 *
 * Failures throw: `SnapshotEmptyError` (code SNAPSHOT_EMPTY) from `assertPublishable`, and
 * `PublishServiceError` carrying a Worker error code for a failed read or write. Neither message
 * contains input, URLs or tokens.
 */
import {
  SNAPSHOT_KEY,
  assertPublishable,
  backupKey,
  buildSnapshot,
  type AlbumRow,
  type CategoryRow,
  type PhotoRow,
  type Snapshot,
  type StorageAdapter,
  type UrlHistoryRow,
  type WorkerErrorCode,
} from '@mp/shared';
import type { SupabaseClient } from './supabase';

/** Newest backups kept in the private bucket. */
export const BACKUPS_TO_KEEP = 20;
export const BACKUP_PREFIX = 'full-';
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
}

/** Full backup document: every row including drafts and hidden categories. */
export interface BackupDocument extends CatalogRows {
  schemaVersion: 1;
  generatedAt: string;
}

export interface PublishServiceDeps {
  supabase: SupabaseClient;
  /** Public bucket (snapshot). */
  publicBucket: StorageAdapter;
  /** Private bucket (backups). */
  backupBucket: StorageAdapter;
  now: () => Date;
}

export interface SnapshotResult {
  snapshot: Snapshot;
  snapshotBytes: number;
  backupKey: string;
  counts: Snapshot['counts'];
}

/** Reads all catalog tables, in a stable order, walking pages. */
export async function loadCatalogRows(supabase: SupabaseClient, jwt: string): Promise<CatalogRows> {
  const read = async <T>(table: string): Promise<T[]> => {
    const res = await supabase.select<T>(table, { select: '*', order: 'id.asc' }, jwt);
    if (!res.ok) throw new PublishServiceError(res.code);
    return res.data;
  };
  return {
    categories: await read<CategoryRow>('categories'),
    albums: await read<AlbumRow>('albums'),
    photos: await read<PhotoRow>('photos'),
    urlHistory: await read<UrlHistoryRow>('url_history'),
  };
}

/** Keep the newest `keep` `full-*.json` files (names sort chronologically), delete the rest. */
export async function pruneBackups(bucket: StorageAdapter, keep: number = BACKUPS_TO_KEEP): Promise<number> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list(BACKUP_PREFIX, cursor === undefined ? {} : { cursor });
    for (const o of page.objects) if (/^full-\d{8}T\d{6}Z\.json$/.test(o.key)) keys.push(o.key);
    cursor = page.cursor;
  } while (cursor !== undefined);
  keys.sort();
  const stale = keys.slice(0, Math.max(0, keys.length - keep));
  if (stale.length > 0) await bucket.delete(stale);
  return stale.length;
}

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

export async function buildAndStoreSnapshot(deps: PublishServiceDeps, jwt: string): Promise<SnapshotResult> {
  const rows = await loadCatalogRows(deps.supabase, jwt);
  const generatedAt = deps.now();
  const snapshot = buildSnapshot(rows, generatedAt);
  assertPublishable(snapshot);

  const backupDoc: BackupDocument = { schemaVersion: 1, generatedAt: generatedAt.toISOString(), ...rows };
  const key = backupKey(generatedAt);
  const snapshotBody = encode(snapshot);
  try {
    await deps.backupBucket.put(key, encode(backupDoc), { contentType: 'application/json' });
    await pruneBackups(deps.backupBucket);
    await deps.publicBucket.put(SNAPSHOT_KEY, snapshotBody, {
      contentType: 'application/json',
      cacheControl: SNAPSHOT_CACHE_CONTROL,
    });
  } catch {
    throw new PublishServiceError('UPSTREAM_ERROR');
  }
  return { snapshot, snapshotBytes: snapshotBody.byteLength, backupKey: key, counts: snapshot.counts };
}
