// Photo upload path of the live migration (plan WP-06 3.3 pre-flight, 3.6, step 9).
// Pre-flight: nothing is written, the exact need is computed from the real encoded sizes and compared with GET /storage.
// Upload: sequential per album in file-number order; one reserve per album (exact files and bytes), PUT with
// bounded concurrency and retries, one re-reserve on an expired presign, one commit per photo in order.
// The first STORAGE_FULL / FILE_TOO_LARGE aborts the whole run. Never logs bodies, URLs or tokens.
// Existing rows (found by legacy_key) are skipped; repair/resume of half-done photos is T-157 and plugs in at `existing`.
import { readFile } from 'node:fs/promises';
import {
  planUploadFiles,
  type CommitRequest,
  type PhotoRow,
  type ReserveRequest,
  type StorageResponse,
  type UploadTarget,
} from '../../packages/shared/src';
import { BackendError, type MigrationBackend } from './backend';
import { processImage, type ProcessedPhoto } from './image';
import { discoverSources, type DiscoverOptions, type SourceAlbum, type SourcePhoto } from './sources';
import type { MigrateOptions } from './types';

export const PUT_CONCURRENCY = 3;
export const PUT_RETRIES = 3;
export const BACKOFF_BASE_MS = 500;
export const RESERVE_MAX_ITEMS = 200;

export interface UploadDeps extends DiscoverOptions {
  read?: (path: string) => Promise<Buffer>;
  /** Backoff wait; tests inject an instant one. */
  sleep?: (ms: number) => Promise<void>;
  backoffMs?: number;
  concurrency?: number;
  retries?: number;
}

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadError';
  }
}

/** First STORAGE_FULL / FILE_TOO_LARGE: stops the whole run. */
class RunAbort extends Error {
  constructor(readonly code: 'STORAGE_FULL' | 'FILE_TOO_LARGE') {
    super(code);
  }
}
const isAbortCode = (c: string): c is 'STORAGE_FULL' | 'FILE_TOO_LARGE' => c === 'STORAGE_FULL' || c === 'FILE_TOO_LARGE';

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ pre-flight

export interface AlbumWork {
  source: SourceAlbum;
  /** Photos that still need uploading, in file-number order. */
  pending: SourcePhoto[];
  /** Photos that already have a row (matched by legacy_key). */
  existing: SourcePhoto[];
}

export interface Preflight {
  albums: AlbumWork[];
  /** Exact bytes to be added (sum of every encoded file of the pending photos). */
  need: number;
  storage: StorageResponse;
  /** Set when the run must not start; nothing has been written. */
  refusal: string | null;
  /** True when used + reserved + need crosses the warn level. */
  warn: boolean;
}

/** Reads the state (listing, GET /storage), encodes every pending photo for its real size, decides. Writes nothing. */
export async function preflight(
  backend: MigrationBackend,
  options: Pick<MigrateOptions, 'album' | 'limitBytes'>,
  deps: UploadDeps = {},
): Promise<Preflight> {
  const discovery = discoverSources({ galleriesDir: deps.galleriesDir, album: options.album, exists: deps.exists });
  if (discovery.missing.length > 0) {
    throw new UploadError(`missing ${discovery.missing.length} source file(s): ${discovery.missing.slice(0, 5).join(', ')}`);
  }
  const read = deps.read ?? ((p: string) => readFile(p));
  const known = new Set((await backend.listPhotosByLegacyKey()).map((p: PhotoRow) => p.legacy_key));
  const albums: AlbumWork[] = discovery.albums.map((source) => ({
    source,
    pending: source.photos.filter((p) => !known.has(p.legacyKey)),
    existing: source.photos.filter((p) => known.has(p.legacyKey)),
  }));

  let need = 0;
  const errors: string[] = [];
  for (const a of albums) {
    for (const p of a.pending) {
      try {
        need += (await processImage(await read(p.path))).bytesTotal;
      } catch (e) {
        errors.push(`${p.legacyKey}: ${(e as Error).message}`);
      }
    }
  }
  const storage = await backend.storage();
  const after = storage.used_bytes + storage.reserved_bytes + need;
  let refusal: string | null = null;
  if (errors.length > 0) refusal = `cannot encode ${errors.length} photo(s): ${errors.slice(0, 3).join('; ')}`;
  else if (after > storage.hard) refusal = `need ${need} bytes would exceed the hard limit (used ${storage.used_bytes}, reserved ${storage.reserved_bytes}, hard ${storage.hard})`;
  else if (options.limitBytes !== null && need > options.limitBytes) refusal = `need ${need} bytes exceeds --limit-bytes ${options.limitBytes}`;
  return { albums, need, storage, refusal, warn: refusal === null && after > storage.warn };
}

// ------------------------------------------------------------------ upload

export interface AlbumUpload {
  id: string;
  found: number;
  inserted: number;
  skipped: number;
  failed: number;
  bytes: number;
  errors: string[];
}

export interface UploadReport {
  albums: AlbumUpload[];
  inserted: number;
  skipped: number;
  failed: number;
  bytes: number;
  aborted: 'STORAGE_FULL' | 'FILE_TOO_LARGE' | null;
  quotaBefore: number;
  quotaAfter: number | null;
  warn: boolean;
}

interface FileJob {
  key: string;
  body: Buffer;
}

interface Prepared {
  photo: SourcePhoto;
  processed: ProcessedPhoto;
  files: FileJob[];
  targets: Map<string, UploadTarget>;
  reReserved: Promise<void> | null;
  error: string | null;
}

const fileBodies = (id: string, p: ProcessedPhoto): FileJob[] =>
  planUploadFiles(id, p.master.w, p.master.h).map((f) => ({
    key: f.key,
    body: f.kind === 'master' ? p.master.buffer : f.kind === 'jpeg' ? p.jpeg.buffer : f.kind === 'og' ? p.og.buffer : p.webp.find((w) => w.tier === f.tier)!.buffer,
  }));

const reserveItem = (id: string, p: ProcessedPhoto): ReserveRequest['items'][number] => ({
  photo_id: id,
  width: p.master.w,
  height: p.master.h,
  files: planUploadFiles(id, p.master.w, p.master.h).map((f) => {
    const bytes = fileBodies(id, p).find((j) => j.key === f.key)!.body.length;
    return f.tier === undefined ? { kind: f.kind, bytes } : { kind: f.kind, tier: f.tier, bytes };
  }),
});

/** Runs the pending photos of every album. `albumIds` maps legacy album id to the stored album id (from the catalog phase). */
export async function uploadPhotos(
  backend: MigrationBackend,
  pre: Preflight,
  albumIds: Record<string, string>,
  deps: UploadDeps = {},
): Promise<UploadReport> {
  const read = deps.read ?? ((p: string) => readFile(p));
  const sleep = deps.sleep ?? realSleep;
  const backoff = deps.backoffMs ?? BACKOFF_BASE_MS;
  const retries = deps.retries ?? PUT_RETRIES;
  const conc = Math.max(1, deps.concurrency ?? PUT_CONCURRENCY);

  async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof BackendError && e.retryable && attempt < retries) {
          await sleep(backoff * 2 ** attempt);
          continue;
        }
        throw e;
      }
    }
  }

  /** Reserve a batch; a refusal stops the run. Returns the targets by photo id. */
  async function reserve(albumId: string, items: ReserveRequest['items']): Promise<Map<string, UploadTarget[]>> {
    const res = await withRetry(() => backend.reserve({ album_id: albumId, items }));
    const out = new Map<string, UploadTarget[]>();
    for (const it of res.items) {
      if (!it.ok) throw new RunAbort(it.code!);
      out.set(it.photo_id, it.uploads!);
    }
    return out;
  }

  const report: UploadReport = {
    albums: [],
    inserted: 0,
    skipped: 0,
    failed: 0,
    bytes: 0,
    aborted: null,
    quotaBefore: pre.storage.used_bytes,
    quotaAfter: null,
    warn: pre.warn,
  };

  try {
    for (const work of pre.albums) {
      const entry: AlbumUpload = {
        id: work.source.album.id,
        found: work.source.photos.length,
        inserted: 0,
        skipped: work.existing.length,
        failed: 0,
        bytes: 0,
        errors: [],
      };
      report.albums.push(entry);
      if (work.pending.length === 0) continue;
      const albumId = albumIds[entry.id];
      if (!albumId) throw new UploadError(`no stored album id for ${entry.id}`);
      const fail = (p: Prepared | SourcePhoto, why: string) => {
        entry.failed++;
        entry.errors.push(`${'photo' in p ? p.photo.legacyKey : p.legacyKey}: ${why}`);
      };

      const prepared: Prepared[] = [];
      for (const photo of work.pending) {
        try {
          const processed = await processImage(await read(photo.path));
          prepared.push({ photo, processed, files: fileBodies(photo.id, processed), targets: new Map(), reReserved: null, error: null });
        } catch (e) {
          fail(photo, (e as Error).message);
        }
      }

      // 1. reserve (exact files and bytes), at most RESERVE_MAX_ITEMS per call
      for (let i = 0; i < prepared.length; i += RESERVE_MAX_ITEMS) {
        const chunk = prepared.slice(i, i + RESERVE_MAX_ITEMS);
        try {
          const got = await reserve(albumId, chunk.map((c) => reserveItem(c.photo.id, c.processed)));
          for (const c of chunk) for (const t of got.get(c.photo.id) ?? []) c.targets.set(t.key, t);
        } catch (e) {
          if (e instanceof RunAbort) throw e;
          if (e instanceof BackendError && isAbortCode(e.code)) throw new RunAbort(e.code);
          for (const c of chunk) c.error = e instanceof BackendError ? e.code : (e as Error).message;
        }
      }

      // 2. PUT every file, bounded concurrency, retry on retryable errors, one re-reserve on an expired presign
      const reReserve = (c: Prepared): Promise<void> => {
        c.reReserved ??= (async () => {
          const got = await reserve(albumId, [reserveItem(c.photo.id, c.processed)]);
          c.targets.clear();
          for (const t of got.get(c.photo.id) ?? []) c.targets.set(t.key, t);
        })();
        return c.reReserved;
      };
      const jobs: Array<() => Promise<void>> = [];
      for (const c of prepared) {
        if (c.error !== null) continue;
        for (const f of c.files) {
          jobs.push(async () => {
            if (c.error !== null) return;
            try {
              try {
                await withRetry(() => backend.put(c.targets.get(f.key)!, f.body));
              } catch (e) {
                if (!(e instanceof BackendError) || e.code !== 'PRESIGN_EXPIRED') throw e;
                // One re-reserve per photo (shared by its concurrent files); a second expiry after that fails the photo.
                await reReserve(c);
                await withRetry(() => backend.put(c.targets.get(f.key)!, f.body));
              }
            } catch (e) {
              if (e instanceof RunAbort) throw e;
              if (e instanceof BackendError && isAbortCode(e.code)) throw new RunAbort(e.code);
              c.error = e instanceof BackendError ? e.code : (e as Error).message;
            }
          });
        }
      }
      let next = 0;
      const worker = async () => {
        while (next < jobs.length) await jobs[next++]!();
      };
      await Promise.all(Array.from({ length: Math.min(conc, jobs.length) }, worker));

      // 3. commit one by one in file-number order (register_photo assigns sort 10, 20, ...)
      for (const c of prepared) {
        if (c.error !== null) {
          fail(c, c.error);
          continue;
        }
        const p = c.processed;
        const request: CommitRequest = {
          photo_id: c.photo.id,
          album_id: albumId,
          width: p.master.w,
          height: p.master.h,
          dominant_color: p.dominantColor,
          legacy_key: c.photo.legacyKey,
          variants: p.variants,
          bytes_total: p.bytesTotal,
        };
        try {
          const res = await withRetry(() => backend.commit(request));
          if (res.already_existed) entry.skipped++;
          else {
            entry.inserted++;
            entry.bytes += p.bytesTotal;
          }
        } catch (e) {
          if (e instanceof BackendError && isAbortCode(e.code)) throw new RunAbort(e.code);
          fail(c, e instanceof BackendError ? e.code : (e as Error).message);
        }
      }
    }
  } catch (e) {
    if (!(e instanceof RunAbort)) throw e;
    report.aborted = e.code;
  }

  for (const a of report.albums) {
    report.inserted += a.inserted;
    report.skipped += a.skipped;
    report.failed += a.failed;
    report.bytes += a.bytes;
  }
  report.quotaAfter = (await backend.storage()).used_bytes;
  return report;
}

/** True when everything expected is present (no failure, no abort). */
export const uploadComplete = (r: UploadReport): boolean => r.aborted === null && r.failed === 0;

export function formatUpload(r: UploadReport): string[] {
  const lines: string[] = [];
  for (const a of r.albums) {
    lines.push(`${a.id.padEnd(13)} found ${a.found} inserted ${a.inserted} skipped ${a.skipped} failed ${a.failed} bytes ${a.bytes}`);
    for (const e of a.errors) lines.push(`  ERROR ${e}`);
  }
  lines.push(`photos inserted ${r.inserted}, skipped ${r.skipped}, failed ${r.failed}, bytes ${r.bytes}`);
  lines.push(`quota used before ${r.quotaBefore}, after ${r.quotaAfter ?? 'unknown'}`);
  if (r.aborted) lines.push(`ABORTED: ${r.aborted} (run stopped at the first refusal)`);
  lines.push(`RESULT: ${uploadComplete(r) ? 'OK' : 'INCOMPLETE'}`);
  return lines;
}
