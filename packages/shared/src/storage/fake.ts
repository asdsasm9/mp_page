/** In-memory StorageAdapter for tests (no network, no real bucket). */
import { StorageError, assertSafeKey, type PresignedPut, type StorageAdapter, type StorageObjectInfo } from './adapter';

export interface FakeStorageOptions {
  baseUrl: string;
  /** Injected clock; defaults to the real time. */
  now?: () => Date;
  /**
   * When true (default) simulatePut rejects a body whose size differs from the presigned
   * contentLength. When false it accepts any size, so tests can cover the "presign did not
   * enforce the length" mitigation.
   */
  enforceContentLength?: boolean;
}

export interface FakeStorage extends StorageAdapter {
  /** Plays the client uploading to a presigned URL. */
  simulatePut(presigned: PresignedPut, body: Uint8Array, headers?: Record<string, string>): Promise<StorageObjectInfo>;
  totalBytes(): number;
  keys(): string[];
}

interface Stored {
  body: Uint8Array;
  contentType?: string;
  cacheControl?: string;
  uploaded: string;
}

interface Grant {
  key: string;
  contentType: string;
  cacheControl?: string;
  contentLength: number;
  expiresAtMs: number;
}

export function createFakeStorage(options: FakeStorageOptions): FakeStorage {
  const now = options.now ?? (() => new Date());
  const enforce = options.enforceContentLength ?? true;
  const base = options.baseUrl.replace(/\/+$/, '');
  const objects = new Map<string, Stored>();
  const grants = new Map<string, Grant>();

  const info = (key: string, s: Stored): StorageObjectInfo => {
    const out: StorageObjectInfo = { key, bytes: s.body.byteLength, uploaded: s.uploaded };
    if (s.contentType !== undefined) out.contentType = s.contentType;
    return out;
  };
  const sortedKeys = () => [...objects.keys()].sort();

  const store = (key: string, body: Uint8Array, contentType: string | undefined, cacheControl?: string) => {
    const s: Stored = { body: body.slice(), uploaded: now().toISOString() };
    if (contentType !== undefined) s.contentType = contentType;
    if (cacheControl !== undefined) s.cacheControl = cacheControl;
    objects.set(key, s);
    return info(key, s);
  };

  return {
    async put(key, body, opts) {
      assertSafeKey(key);
      return store(key, body, opts.contentType, opts.cacheControl);
    },
    async head(key) {
      assertSafeKey(key);
      const s = objects.get(key);
      return s ? info(key, s) : null;
    },
    async delete(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) assertSafeKey(k);
      for (const k of list) objects.delete(k);
    },
    async list(prefix, opts = {}) {
      if (prefix !== '') assertSafeKey(prefix);
      const limit = Math.max(1, opts.limit ?? 1000);
      const matching = sortedKeys().filter((k) => k.startsWith(prefix) && (opts.cursor === undefined || k > opts.cursor));
      const page = matching.slice(0, limit);
      const out: { objects: StorageObjectInfo[]; cursor?: string } = {
        objects: page.map((k) => info(k, objects.get(k)!)),
      };
      if (matching.length > limit) out.cursor = page[page.length - 1]!;
      return out;
    },
    async presignPut(key, opts) {
      assertSafeKey(key);
      const expiresAtMs = now().getTime() + opts.expiresInSec * 1000;
      const url = `fake://put/${key}?exp=${expiresAtMs}`;
      const grant: Grant = { key, contentType: opts.contentType, contentLength: opts.contentLength, expiresAtMs };
      const headers: Record<string, string> = {
        'content-type': opts.contentType,
        'content-length': String(opts.contentLength),
      };
      if (opts.cacheControl !== undefined) {
        grant.cacheControl = opts.cacheControl;
        headers['cache-control'] = opts.cacheControl;
      }
      grants.set(url, grant);
      return {
        url,
        method: 'PUT',
        headers,
        expiresAt: new Date(expiresAtMs).toISOString(),
      };
    },
    publicUrl(key) {
      assertSafeKey(key);
      return `${base}/${key}`;
    },
    async simulatePut(presigned, body, headers = {}) {
      const g = grants.get(presigned.url);
      if (!g) throw new StorageError('UNKNOWN_URL');
      if (now().getTime() > g.expiresAtMs) throw new StorageError('URL_EXPIRED');
      if (enforce) {
        if (body.byteLength !== g.contentLength) {
          throw new StorageError('CONTENT_LENGTH_MISMATCH', `CONTENT_LENGTH_MISMATCH: expected ${g.contentLength}, got ${body.byteLength}`);
        }
        const ct = headers['content-type'] ?? headers['Content-Type'];
        if (ct !== undefined && ct !== g.contentType) throw new StorageError('CONTENT_TYPE_MISMATCH');
      }
      return store(g.key, body, headers['content-type'] ?? headers['Content-Type'] ?? g.contentType, g.cacheControl);
    },
    totalBytes() {
      let n = 0;
      for (const s of objects.values()) n += s.body.byteLength;
      return n;
    },
    keys() {
      return sortedKeys();
    },
  };
}
