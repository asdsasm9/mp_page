/**
 * One presigned PUT. The real adapter uses XHR (progress, abort) and sends the signed headers exactly as
 * given, except content-length, which the browser sets itself. Errors: UploadHttpError (non-2xx; 403 when
 * the URL expired), UploadAbortedError, NetworkError.
 */
import type { UploadTarget } from '@mp/shared';

export interface PutOptions {
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

export interface UploadPort {
  put(target: Pick<UploadTarget, 'url' | 'method' | 'headers'>, body: Blob, options?: PutOptions): Promise<void>;
}
