// Backup master fetcher (plan WP-08 section 4.3). Downloads photos/<id>/master.jpg from the public image host
// into <out>/masters/<id>.jpg. Read-only (GET only). All I/O is injected (fetch, fs, sleep, clock).
// URL = PUBLIC_IMG_BASE_URL + masterKey(id) from packages/shared keys.ts, nothing else; the id is validated as a
// UUID first. Same host only (redirects are followed by hand and refused when they leave the origin).
// Errors carry codes only: no URLs, bodies or credentials reach the result, the manifest or any log.
import { createHash } from 'node:crypto';
import { isValidPhotoId, masterKey } from '../../packages/shared/src';
import type { FetchLike } from '../migrate-legacy/http-backend';

export interface BackupFs {
  mkdir(path: string): Promise<void>;
  /** null when the file does not exist. */
  readFile(path: string): Promise<Uint8Array | null>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string): Promise<void>;
}

export interface ManifestEntry {
  id: string;
  bytes: number;
  sha256: string;
  /** Source key on the image host (not a URL, no credentials). */
  source: string;
  fetchedAt: string;
}

export interface Manifest {
  schemaVersion: 1;
  entries: ManifestEntry[];
}

export type FailureCode =
  | 'INVALID_ID'
  | 'NOT_FOUND'
  | 'HTTP_ERROR'
  | 'TOO_LARGE'
  | 'REDIRECT_OFF_HOST'
  | 'TOO_MANY_REDIRECTS'
  | 'NETWORK'
  | 'SIZE_MISMATCH'
  | 'WRITE_FAILED';

export interface MasterFailure {
  /** The id as given when it is a valid UUID; invalid ids are not echoed. */
  id: string;
  code: FailureCode;
  status?: number;
}

export interface MasterItem {
  id: string;
  /** Declared master size from the catalog, used for the total-bytes pre-check. */
  expectedBytes?: number;
}

export interface MastersOptions {
  imgBaseUrl: string;
  outDir: string;
  items: readonly MasterItem[];
  fs: BackupFs;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  maxPhotos: number;
  maxBytes: number;
  /** Per response cap. Default 40 MiB + 1 MiB (the per-file upload limit with headroom). */
  maxFileBytes?: number;
  concurrency?: number;
  retries?: number;
  retryDelayMs?: number;
}

export interface MastersResult {
  written: number;
  skipped: number;
  failed: MasterFailure[];
  /** Bytes downloaded in this run. */
  downloadedBytes: number;
  manifest: Manifest;
}

export class CapError extends Error {
  constructor(readonly code: 'MAX_PHOTOS' | 'MAX_BYTES') {
    super(code);
    this.name = 'CapError';
  }
}

const MAX_CONCURRENCY = 4;
const MAX_REDIRECTS = 3;
const DEFAULT_MAX_FILE = 41 * 1024 * 1024;
const MANIFEST_NAME = 'manifest.json';

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');
const join = (...parts: string[]) => parts.map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, ''))).join('/');

/** Validated image host base: https (http only for localhost), no credentials. */
export function parseImgBase(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('PUBLIC_IMG_BASE_URL is not a valid URL');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.username !== '' || url.password !== '') throw new Error('PUBLIC_IMG_BASE_URL must not contain credentials');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('PUBLIC_IMG_BASE_URL must use https');
  return url;
}

export function masterUrl(imgBase: string, id: string): string {
  return `${imgBase.replace(/\/+$/, '')}/${masterKey(id)}`;
}

const emptyManifest = (): Manifest => ({ schemaVersion: 1, entries: [] });

export async function readManifest(fs: BackupFs, outDir: string): Promise<Manifest> {
  const raw = await fs.readFile(join(outDir, MANIFEST_NAME));
  if (raw === null) return emptyManifest();
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
    if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as Manifest).entries)) {
      const entries = (parsed as Manifest).entries.filter(
        (e): e is ManifestEntry =>
          typeof e === 'object' && e !== null && typeof e.id === 'string' && typeof e.sha256 === 'string' && typeof e.bytes === 'number',
      );
      return { schemaVersion: 1, entries };
    }
  } catch {
    /* a damaged manifest is treated as empty: everything is re-verified or re-fetched */
  }
  return emptyManifest();
}

export async function writeAtomic(fs: BackupFs, dest: string, data: Uint8Array): Promise<void> {
  const tmp = `${dest}.part`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, dest);
  } catch (e) {
    await fs.rm(tmp).catch(() => undefined);
    throw e;
  }
}

class Failure extends Error {
  constructor(
    readonly code: FailureCode,
    readonly status?: number,
  ) {
    super(code);
  }
}

export async function backupMasters(opts: MastersOptions): Promise<MastersResult> {
  const base = parseImgBase(opts.imgBaseUrl);
  const fetchFn: FetchLike = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => new Date());
  const retries = opts.retries ?? 3;
  const retryDelay = opts.retryDelayMs ?? 500;
  const maxFile = opts.maxFileBytes ?? DEFAULT_MAX_FILE;
  const concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, opts.concurrency ?? MAX_CONCURRENCY));
  const { fs } = opts;

  // Caps first: refuse before anything is fetched or written.
  if (opts.items.length > opts.maxPhotos) throw new CapError('MAX_PHOTOS');
  const declared = opts.items.reduce((s, i) => s + (i.expectedBytes ?? 0), 0);
  if (declared > opts.maxBytes) throw new CapError('MAX_BYTES');

  const mastersDir = join(opts.outDir, 'masters');
  await fs.mkdir(mastersDir);
  const previous = new Map((await readManifest(fs, opts.outDir)).entries.map((e) => [e.id, e] as const));
  const entries = new Map<string, ManifestEntry>();
  const failed: MasterFailure[] = [];
  let written = 0;
  let skipped = 0;
  let downloaded = 0;

  async function download(id: string): Promise<Uint8Array> {
    let url = masterUrl(base.href, id);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let res: Response | undefined;
      for (let attempt = 0; ; attempt++) {
        try {
          res = await fetchFn(url, { method: 'GET', redirect: 'manual', cache: 'no-store' });
        } catch {
          res = undefined;
        }
        const retryable = res === undefined || res.status === 429 || res.status >= 500;
        if (!retryable) break;
        if (attempt >= retries) {
          if (res === undefined) throw new Failure('NETWORK');
          throw new Failure('HTTP_ERROR', res.status);
        }
        await res?.body?.cancel().catch(() => undefined);
        await sleep(retryDelay * (attempt + 1));
      }
      const r = res!;
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get('location');
        await r.body?.cancel().catch(() => undefined);
        if (!loc) throw new Failure('HTTP_ERROR', r.status);
        let next: URL;
        try {
          next = new URL(loc, url);
        } catch {
          throw new Failure('HTTP_ERROR', r.status);
        }
        if (next.origin !== base.origin) throw new Failure('REDIRECT_OFF_HOST');
        url = next.href;
        continue;
      }
      if (r.status === 404) throw new Failure('NOT_FOUND', 404);
      if (!r.ok) throw new Failure('HTTP_ERROR', r.status);
      return readBody(r);
    }
    throw new Failure('TOO_MANY_REDIRECTS');
  }

  async function readBody(r: Response): Promise<Uint8Array> {
    const declaredLen = r.headers.get('content-length');
    if (declaredLen !== null && Number(declaredLen) > maxFile) {
      await r.body?.cancel().catch(() => undefined);
      throw new Failure('TOO_LARGE');
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (r.body) {
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxFile || downloaded + total > opts.maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new Failure('TOO_LARGE');
        }
        chunks.push(value);
      }
    } else {
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.byteLength > maxFile || downloaded + buf.byteLength > opts.maxBytes) throw new Failure('TOO_LARGE');
      chunks.push(buf);
      total = buf.byteLength;
    }
    if (declaredLen !== null && Number(declaredLen) !== total) throw new Failure('SIZE_MISMATCH');
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    return out;
  }

  async function one(item: MasterItem): Promise<void> {
    const { id } = item;
    if (!isValidPhotoId(id)) {
      failed.push({ id: '(invalid)', code: 'INVALID_ID' });
      return;
    }
    const dest = join(mastersDir, `${id}.jpg`);
    try {
      // Idempotent skip: manifest entry plus a file whose bytes and sha256 still match.
      const prev = previous.get(id);
      if (prev) {
        const existing = await fs.readFile(dest);
        if (existing !== null && existing.byteLength === prev.bytes && sha256(existing) === prev.sha256) {
          entries.set(id, prev);
          skipped++;
          return;
        }
      }
      const data = await download(id);
      await writeAtomic(fs, dest, data);
      const digest = sha256(data);
      // Re-hash what is on disk before it earns a manifest entry.
      const back = await fs.readFile(dest);
      if (back === null || back.byteLength !== data.byteLength || sha256(back) !== digest) throw new Failure('WRITE_FAILED');
      downloaded += data.byteLength;
      written++;
      entries.set(id, { id, bytes: data.byteLength, sha256: digest, source: masterKey(id), fetchedAt: now().toISOString() });
    } catch (e) {
      failed.push(e instanceof Failure ? { id, code: e.code, ...(e.status === undefined ? {} : { status: e.status }) } : { id, code: 'WRITE_FAILED' });
    }
  }

  const queue = [...opts.items];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await one(item);
    }),
  );

  // Entries of photos no longer in the catalog stay: their files are still on disk and still protected.
  const requested = new Set(opts.items.map((i) => i.id));
  for (const [id, e] of previous) if (!requested.has(id)) entries.set(id, e);
  const manifest: Manifest = { schemaVersion: 1, entries: [...entries.values()].sort((a, b) => (a.id < b.id ? -1 : 1)) };
  await writeAtomic(fs, join(opts.outDir, MANIFEST_NAME), new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`));
  failed.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { written, skipped, failed, downloadedBytes: downloaded, manifest };
}
