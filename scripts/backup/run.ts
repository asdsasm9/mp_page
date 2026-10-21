// Backup core: catalog.json + masters + manifest.json into <out>. Pure orchestration over injected deps
// (fetch, fs); the CLI (T-192) supplies the real ones and the live guards. Never writes credentials anywhere.
import { readCatalog, type CatalogConfig } from './catalog';
import { backupMasters, writeAtomic, type BackupFs, type MastersResult } from './masters';
import type { FetchLike } from '../migrate-legacy/http-backend';

export interface BackupRunOptions {
  catalog: Omit<CatalogConfig, 'fetch' | 'now'>;
  imgBaseUrl: string;
  outDir: string;
  fs: BackupFs;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  maxPhotos: number;
  maxBytes: number;
  retryDelayMs?: number;
}

export interface BackupRunResult {
  counts: { categories: number; albums: number; photos: number; urlHistory: number };
  masters: MastersResult;
  /** Failed photos (404 etc.); the rest were still written. */
  failed: MastersResult['failed'];
}

export async function runBackup(opts: BackupRunOptions): Promise<BackupRunResult> {
  const doc = await readCatalog({
    ...opts.catalog,
    ...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
    ...(opts.now === undefined ? {} : { now: opts.now }),
  });
  // Caps are checked inside backupMasters before any master is fetched; the catalog is only written after.
  const masters = await backupMasters({
    imgBaseUrl: opts.imgBaseUrl,
    outDir: opts.outDir,
    items: doc.photos.map((p) => ({ id: p.id, expectedBytes: p.variants.master.bytes })),
    fs: opts.fs,
    ...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
    ...(opts.sleep === undefined ? {} : { sleep: opts.sleep }),
    ...(opts.now === undefined ? {} : { now: opts.now }),
    ...(opts.retryDelayMs === undefined ? {} : { retryDelayMs: opts.retryDelayMs }),
    maxPhotos: opts.maxPhotos,
    maxBytes: opts.maxBytes,
  });
  await writeAtomic(opts.fs, `${opts.outDir.replace(/\/+$/, '')}/catalog.json`, new TextEncoder().encode(`${JSON.stringify(doc, null, 2)}\n`));
  return {
    counts: { categories: doc.categories.length, albums: doc.albums.length, photos: doc.photos.length, urlHistory: doc.urlHistory.length },
    masters,
    failed: masters.failed,
  };
}
