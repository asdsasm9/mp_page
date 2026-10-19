/**
 * Authentication and authorization (WP-4 section 4.3). Bearer JWT, cheap shape check first (no
 * subrequest for garbage), then the `is_admin` RPC with the caller's own JWT. No local JWT
 * verification. Fails closed: any upstream failure gives 503, never a pass.
 *
 * The token and the Authorization header are never logged, echoed or stored.
 */
import type { SupabaseClient } from './supabase';
import { errorResponse } from './http';

/** Total token length limit. */
export const MAX_TOKEN_LENGTH = 4096;

const BEARER = /^Bearer ([^\s]+)$/i;
const BASE64URL_PART = /^[A-Za-z0-9_-]+$/;

/** Three non-empty base64url parts, total at most 4096 characters. */
export function isTokenShapeValid(token: string): boolean {
  if (token.length > MAX_TOKEN_LENGTH) return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every((p) => BASE64URL_PART.test(p));
}

export type AuthResult = { ok: true; jwt: string } | { ok: false; response: Response };

export async function authenticate(request: Request, supabase: SupabaseClient): Promise<AuthResult> {
  const deny = (code: 'UNAUTHENTICATED' | 'NOT_ADMIN' | 'UPSTREAM_ERROR', reason: string): AuthResult => {
    // Reason is a fixed label: no token, header or upstream text.
    console.warn(`AUTH denied: ${reason}`);
    return {
      ok: false,
      response: code === 'UPSTREAM_ERROR' ? errorResponse(code, { status: 503 }) : errorResponse(code),
    };
  };

  const header = request.headers.get('authorization');
  if (header === null) return deny('UNAUTHENTICATED', 'missing header');
  if (header.length > MAX_TOKEN_LENGTH + 'Bearer '.length) return deny('UNAUTHENTICATED', 'header too long');
  const match = BEARER.exec(header);
  if (!match) return deny('UNAUTHENTICATED', 'bad scheme');
  const jwt = match[1]!;
  if (!isTokenShapeValid(jwt)) return deny('UNAUTHENTICATED', 'bad token shape');

  const res = await supabase.rpc<unknown>('is_admin', {}, jwt);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) return deny('UNAUTHENTICATED', 'rejected by upstream');
    return deny('UPSTREAM_ERROR', 'upstream unavailable');
  }
  if (res.data === true) return { ok: true, jwt };
  if (res.data === false) return deny('NOT_ADMIN', 'not an admin');
  return deny('UPSTREAM_ERROR', 'unexpected is_admin result');
}
