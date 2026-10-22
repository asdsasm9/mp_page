/**
 * R2 StorageAdapter (WP-4 section 4.6). Object operations go through the Workers R2 binding,
 * presigned PUT URLs through aws4fetch against the S3 endpoint. All keys are checked with
 * `assertSafeKey` first. Only this folder (and shared storage) may touch R2 (gate no-direct-r2).
 */
import { AwsV4Signer } from 'aws4fetch';
import {
  StorageError,
  assertSafeKey,
  type PresignedPut,
  type StorageAdapter,
  type StorageObjectInfo,
} from '@mp/shared';

/** The part of an R2 object the adapter reads. */
export interface R2ObjectPort {
  key: string;
  size: number;
  uploaded: Date;
  httpMetadata?: { contentType?: string; cacheControl?: string };
}

/** The part of the R2 binding the adapter uses (the real `R2Bucket` satisfies it, checked below). */
export interface R2BucketPort {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<R2ObjectPort | null>;
  head(key: string): Promise<R2ObjectPort | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ objects: R2ObjectPort[]; truncated: boolean; cursor?: string }>;
}

// Compile-time proof that the real binding fits the port (no runtime cost).
export type _BindingFitsPort = R2Bucket extends R2BucketPort ? true : never;

export interface R2PresignConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Bucket name as used in the S3 path. */
  bucketName: string;
}

export interface R2AdapterOptions {
  bucket: R2BucketPort;
  /** Public base URL without trailing slash. Optional (omitted in tests). */
  publicBaseUrl?: string;
  /** Presign credentials. Optional (omitted in tests). */
  presign?: R2PresignConfig;
  now?: () => Date;
}

/** R2 accepts at most 1000 keys per delete call. */
export const DELETE_CHUNK = 1000;
const MAX_LIST = 1000;

const toInfo = (o: R2ObjectPort): StorageObjectInfo => {
  const info: StorageObjectInfo = { key: o.key, bytes: o.size, uploaded: o.uploaded.toISOString() };
  const ct = o.httpMetadata?.contentType;
  if (ct !== undefined) info.contentType = ct;
  return info;
};

export function createR2Storage(options: R2AdapterOptions): StorageAdapter {
  const { bucket } = options;
  const now = options.now ?? (() => new Date());
  const publicBase = options.publicBaseUrl?.replace(/\/+$/, '');

  return {
    async put(key, body, opts) {
      assertSafeKey(key);
      const httpMetadata: { contentType: string; cacheControl?: string } = { contentType: opts.contentType };
      if (opts.cacheControl !== undefined) httpMetadata.cacheControl = opts.cacheControl;
      const obj = await bucket.put(key, body, { httpMetadata });
      if (obj) return toInfo(obj);
      const head = await bucket.head(key);
      return head ? toInfo(head) : { key, bytes: body.byteLength, contentType: opts.contentType };
    },

    async head(key) {
      assertSafeKey(key);
      const obj = await bucket.head(key);
      return obj ? toInfo(obj) : null;
    },

    async delete(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) assertSafeKey(k);
      for (let i = 0; i < list.length; i += DELETE_CHUNK) {
        await bucket.delete(list.slice(i, i + DELETE_CHUNK));
      }
    },

    async list(prefix, opts = {}) {
      if (prefix !== '') assertSafeKey(prefix);
      const limit = Math.min(MAX_LIST, Math.max(1, Math.floor(opts.limit ?? MAX_LIST)));
      const query: { prefix: string; limit: number; cursor?: string } = { prefix, limit };
      if (opts.cursor !== undefined) query.cursor = opts.cursor;
      const res = await bucket.list(query);
      const out: { objects: StorageObjectInfo[]; cursor?: string } = { objects: res.objects.map(toInfo) };
      if (res.truncated && res.cursor !== undefined) out.cursor = res.cursor;
      return out;
    },

    async presignPut(key, opts): Promise<PresignedPut> {
      assertSafeKey(key);
      const cfg = options.presign;
      if (!cfg) throw new StorageError('NOT_CONFIGURED', 'NOT_CONFIGURED: presign credentials');
      const path = key.split('/').map(encodeURIComponent).join('/');
      const url = `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucketName}/${path}?X-Amz-Expires=${Math.floor(opts.expiresInSec)}`;
      const headers: Record<string, string> = {
        'content-type': opts.contentType,
        'content-length': String(opts.contentLength),
      };
      if (opts.cacheControl !== undefined) headers['cache-control'] = opts.cacheControl;
      const at = now();
      const signed = await new AwsV4Signer({
        method: 'PUT',
        url,
        headers,
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        service: 's3',
        region: 'auto',
        signQuery: true,
        // content-type and content-length are unsignable by default; we want them signed.
        allHeaders: true,
        datetime: at.toISOString().replace(/[:-]|\.\d{3}/g, ''),
      }).sign();
      return {
        url: signed.url.toString(),
        method: 'PUT',
        headers,
        expiresAt: new Date(at.getTime() + opts.expiresInSec * 1000).toISOString(),
      };
    },

    publicUrl(key) {
      assertSafeKey(key);
      if (publicBase === undefined) throw new StorageError('NOT_CONFIGURED', 'NOT_CONFIGURED: public base url');
      return `${publicBase}/${key}`;
    },
  };
}
