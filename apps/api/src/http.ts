/**
 * JSON response helpers, error mapping and the request body limit (WP-4 section 4.5).
 * Error bodies are `{ error: CODE, retryAfter? }` and never carry input, stack, SQL or secrets.
 */
import { ERROR_STATUS, type WorkerErrorCode } from '@mp/shared';

/** JSON bodies are at most 256 KB. */
export const MAX_BODY_BYTES = 256 * 1024;

/** Set on every response, success or error. */
export const BASE_HEADERS: Readonly<Record<string, string>> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  vary: 'Origin',
};

export function jsonResponse(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...BASE_HEADERS, ...extra },
  });
}

export interface ErrorOptions {
  /** Override the default status for the code (e.g. 503 for UPSTREAM_ERROR when failing closed). */
  status?: number;
  retryAfter?: number;
  headers?: Record<string, string>;
}

export function errorResponse(code: WorkerErrorCode, options: ErrorOptions = {}): Response {
  const body: { error: WorkerErrorCode; retryAfter?: number } = { error: code };
  if (options.retryAfter !== undefined) body.retryAfter = options.retryAfter;
  return jsonResponse(body, options.status ?? ERROR_STATUS[code], options.headers);
}

/**
 * Return a response that carries the base headers. The input is never mutated (its headers may be
 * immutable, e.g. a fetch() result or a proxied Response): a new Response shares the body stream.
 */
export function withBaseHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(BASE_HEADERS)) {
    if (k === 'vary') {
      const cur = headers.get('vary');
      if (!cur) headers.set('vary', v);
      else if (!cur.split(',').some((p) => p.trim().toLowerCase() === 'origin')) headers.set('vary', `${cur}, ${v}`);
    } else {
      headers.set(k, v);
    }
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export type BodyResult = { ok: true; value: unknown } | { ok: false; code: WorkerErrorCode };

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false;
  const media = value.split(';')[0]!.trim().toLowerCase();
  return media === 'application/json';
}

/**
 * Read a JSON body with the size limit enforced on the declared Content-Length and again while
 * streaming (a lying or missing Content-Length cannot bypass it). Content type must be
 * application/json. Failures: 400 INVALID_REQUEST (type, syntax, empty), 413 PAYLOAD_TOO_LARGE.
 */
export async function readJsonBody(
  request: Request,
  options: { maxBytes?: number; allowEmpty?: boolean } = {},
): Promise<BodyResult> {
  const max = options.maxBytes ?? MAX_BODY_BYTES;

  const declared = request.headers.get('content-length');
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) return { ok: false, code: 'INVALID_REQUEST' };
    if (Number(declared) > max) return { ok: false, code: 'PAYLOAD_TOO_LARGE' };
  }

  const hasBody = request.body !== null;
  if (!hasBody || declared === '0') {
    return options.allowEmpty ? { ok: true, value: {} } : { ok: false, code: 'INVALID_REQUEST' };
  }

  if (!isJsonContentType(request.headers.get('content-type'))) return { ok: false, code: 'INVALID_REQUEST' };

  const reader = request.body!.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, code: 'PAYLOAD_TOO_LARGE' };
    }
    chunks.push(value);
  }
  if (total === 0) return options.allowEmpty ? { ok: true, value: {} } : { ok: false, code: 'INVALID_REQUEST' };

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown };
  } catch {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
}
