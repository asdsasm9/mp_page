/**
 * Exact-origin CORS (WP-4 section 4.4). Auth is a Bearer token, so there are no credentials:
 * Access-Control-Allow-Credentials is never set. CORS is not an authentication mechanism, so a
 * request without Origin (curl, cron) passes through to auth.
 */
import { errorResponse } from './http';

export const CORS_METHODS = 'GET, POST, OPTIONS';
export const CORS_HEADERS = 'authorization, content-type';
export const CORS_MAX_AGE = '600';

export type OriginCheck =
  | { kind: 'none' }
  | { kind: 'allowed'; origin: string }
  | { kind: 'denied' };

/** Exact string match against the allowlist; anything else (look-alikes, `null`, slash) is denied. */
export function checkOrigin(request: Request, allowed: readonly string[]): OriginCheck {
  const origin = request.headers.get('origin');
  if (origin === null) return { kind: 'none' };
  return allowed.includes(origin) ? { kind: 'allowed', origin } : { kind: 'denied' };
}

/** Add the response CORS header for an allowed origin (the exact origin, never `*`). */
export function applyCors(response: Response, check: OriginCheck): Response {
  if (check.kind === 'allowed') response.headers.set('access-control-allow-origin', check.origin);
  return response;
}

/** 204 answer to a preflight, before auth. */
export function preflightResponse(check: OriginCheck): Response {
  const headers: Record<string, string> = {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    vary: 'Origin',
  };
  if (check.kind === 'allowed') {
    headers['access-control-allow-origin'] = check.origin;
    headers['access-control-allow-methods'] = CORS_METHODS;
    headers['access-control-allow-headers'] = CORS_HEADERS;
    headers['access-control-max-age'] = CORS_MAX_AGE;
  }
  return new Response(null, { status: 204, headers });
}

/** 403 for a disallowed Origin, without CORS headers. */
export function deniedOriginResponse(): Response {
  return errorResponse('INVALID_REQUEST', { status: 403 });
}
