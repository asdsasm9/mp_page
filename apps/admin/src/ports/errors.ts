/**
 * Errors every adapter (real or fake) throws. The UI maps them to Czech text (WP5-03); messages here
 * are developer-facing codes only and never carry input, tokens, URLs or e-mail addresses.
 */
import { ERROR_STATUS, type WorkerErrorCode } from '@mp/shared';

/** The Worker answered with an error body (`{ error, retryAfter? }`). */
export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: WorkerErrorCode,
    options: { status?: number; retryAfter?: number } = {},
  ) {
    super(code);
    this.name = 'ApiError';
    this.status = options.status ?? ERROR_STATUS[code];
    if (options.retryAfter !== undefined) this.retryAfter = options.retryAfter;
  }
  /** Seconds, only for PUBLISH_TOO_SOON. */
  retryAfter?: number;
}

/** The request never got an answer (offline, DNS, CORS, reset). */
export class NetworkError extends Error {
  constructor() {
    super('NETWORK');
    this.name = 'NetworkError';
  }
}

export type CatalogErrorCode =
  | 'STALE' // updated_at no longer matches: someone else changed the row
  | 'NOT_FOUND'
  | 'DUPLICATE_SLUG'
  | 'IN_USE' // foreign key: the row still has children
  | 'COVER_NOT_IN_ALBUM'
  | 'INVALID'; // a check constraint (slug format, reserved slug, length)

/** A PostgREST (database) refusal. */
export class CatalogError extends Error {
  constructor(readonly code: CatalogErrorCode) {
    super(code);
    this.name = 'CatalogError';
  }
}

export type AuthErrorCode = 'TOO_MANY_ATTEMPTS';

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.name = 'AuthError';
  }
}

/** The storage host answered a PUT with a non-2xx status (403 for an expired or mismatching signature). */
export class UploadHttpError extends Error {
  constructor(readonly status: number) {
    super(`UPLOAD_HTTP_${status}`);
    this.name = 'UploadHttpError';
  }
}

/** The caller aborted the PUT (cancel). */
export class UploadAbortedError extends Error {
  constructor() {
    super('UPLOAD_ABORTED');
    this.name = 'UploadAbortedError';
  }
}

/** Selection asked for an adapter set that does not exist yet. The text is shown to the photographer. */
export class AdapterUnavailableError extends Error {
  constructor() {
    super('Připojení k serveru zatím není k dispozici. Obraťte se na správce webu.');
    this.name = 'AdapterUnavailableError';
  }
}
