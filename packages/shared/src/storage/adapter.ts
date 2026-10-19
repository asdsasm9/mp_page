/** Object storage port. Implementations live in storage folders only (gate no-direct-r2). */
import { isSafeKey } from '../keys';

export interface StorageObjectInfo {
  key: string;
  bytes: number;
  contentType?: string;
}

export interface PresignedPut {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

export interface StorageAdapter {
  put(key: string, body: Uint8Array, opts: { contentType: string; cacheControl?: string }): Promise<StorageObjectInfo>;
  head(key: string): Promise<StorageObjectInfo | null>;
  /** Missing keys are not an error. */
  delete(keys: string | string[]): Promise<void>;
  list(prefix: string, opts?: { cursor?: string; limit?: number }): Promise<{ objects: StorageObjectInfo[]; cursor?: string }>;
  presignPut(
    key: string,
    opts: { contentType: string; contentLength: number; expiresInSec: number },
  ): Promise<PresignedPut>;
  publicUrl(key: string): string;
}

export type StorageErrorCode = 'INVALID_KEY' | 'URL_EXPIRED' | 'CONTENT_LENGTH_MISMATCH' | 'CONTENT_TYPE_MISMATCH' | 'UNKNOWN_URL';

export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'StorageError';
  }
}

/** Throws StorageError('INVALID_KEY') for an unsafe key. */
export function assertSafeKey(key: string): void {
  if (!isSafeKey(key)) throw new StorageError('INVALID_KEY', `INVALID_KEY: ${JSON.stringify(String(key).slice(0, 80))}`);
}
