/**
 * Minimal PostgREST client (WP-4 section 4.2, 4.3, 4.7). Every call carries the anon key as
 * `apikey` and the CALLER's JWT as `Authorization`, so RLS and function-level `is_admin` checks
 * always apply. There is no other credential in the Worker. The `fetch` is injected.
 *
 * Errors are mapped to our codes and never echo the upstream body, URL or the token.
 */
import { isApiErrorCode, type WorkerErrorCode } from '@mp/shared';

export type FetchFn = (input: Request | string | URL, init?: RequestInit) => Promise<Response>;

export type SupabaseResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: WorkerErrorCode;
      /** Upstream HTTP status, or 0 when there was no response (network error, timeout). */
      status: number;
    };

export interface SupabaseOptions {
  supabaseUrl: string;
  anonKey: string;
  fetch: FetchFn;
  /** Per-request timeout in ms (default 8000). */
  timeoutMs?: number;
}

export interface SelectOptions {
  /** Rows per page (default and maximum 1000). */
  pageSize?: number;
  /** Safety cap on the number of pages walked (default 50). */
  maxPages?: number;
}

export interface SupabaseClient {
  rpc<T = unknown>(name: string, args: unknown, jwt: string): Promise<SupabaseResult<T>>;
  /** All rows of a table/query, walking pages until a short page. `query` are PostgREST params. */
  select<T = unknown>(
    table: string,
    query: Record<string, string> | undefined,
    jwt: string,
    options?: SelectOptions,
  ): Promise<SupabaseResult<T[]>>;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_PAGE_SIZE = 1000;

/** Map a failed PostgREST response to our code without echoing anything from it. */
export function mapSupabaseError(status: number, body: unknown): WorkerErrorCode {
  if (body !== null && typeof body === 'object') {
    const { message, code } = body as { message?: unknown; code?: unknown };
    if (isApiErrorCode(message)) return message;
    // SQLSTATE 42501 (insufficient privilege / RLS) means the caller is not an admin.
    if (code === '42501') return 'NOT_ADMIN';
  }
  if (status === 401) return 'UNAUTHENTICATED';
  return 'UPSTREAM_ERROR';
}

export function createSupabaseClient(options: SupabaseOptions): SupabaseClient {
  const base = options.supabaseUrl.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function send(url: string, init: RequestInit, jwt: string, extra: Record<string, string>) {
    if (jwt === '') return { ok: false as const, code: 'UNAUTHENTICATED' as const, status: 0 };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = new Headers({
        accept: 'application/json',
        ...extra,
        apikey: options.anonKey,
        authorization: `Bearer ${jwt}`,
      });
      const res = await options.fetch(url, { ...init, headers, signal: controller.signal });
      let body: unknown = null;
      let parsed = true;
      const text = await res.text();
      if (text !== '') {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          parsed = false;
        }
      }
      if (!res.ok) {
        return { ok: false as const, code: mapSupabaseError(res.status, parsed ? body : null), status: res.status };
      }
      if (!parsed) return { ok: false as const, code: 'UPSTREAM_ERROR' as const, status: res.status };
      return { ok: true as const, body, status: res.status };
    } catch {
      // Network error, abort/timeout or an unusable header value: nothing is echoed.
      return { ok: false as const, code: 'UPSTREAM_ERROR' as const, status: 0 };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async rpc<T>(name: string, args: unknown, jwt: string): Promise<SupabaseResult<T>> {
      if (!IDENT.test(name)) return { ok: false, code: 'INTERNAL', status: 0 };
      const r = await send(
        `${base}/rest/v1/rpc/${name}`,
        { method: 'POST', body: JSON.stringify(args ?? {}) },
        jwt,
        { 'content-type': 'application/json' },
      );
      return r.ok ? { ok: true, data: r.body as T } : r;
    },

    async select<T>(
      table: string,
      query: Record<string, string> | undefined,
      jwt: string,
      opts: SelectOptions = {},
    ): Promise<SupabaseResult<T[]>> {
      if (!IDENT.test(table)) return { ok: false, code: 'INTERNAL', status: 0 };
      const pageSize = Math.min(Math.max(1, Math.floor(opts.pageSize ?? MAX_PAGE_SIZE)), MAX_PAGE_SIZE);
      const maxPages = opts.maxPages ?? 50;
      const params = new URLSearchParams(query ?? {}).toString();
      const url = `${base}/rest/v1/${table}${params === '' ? '' : `?${params}`}`;
      const rows: T[] = [];
      for (let page = 0; page < maxPages; page++) {
        const from = page * pageSize;
        const r = await send(url, { method: 'GET' }, jwt, {
          'range-unit': 'items',
          range: `${from}-${from + pageSize - 1}`,
        });
        if (!r.ok) return r;
        if (!Array.isArray(r.body)) return { ok: false, code: 'UPSTREAM_ERROR', status: r.status };
        rows.push(...(r.body as T[]));
        if (r.body.length < pageSize) return { ok: true, data: rows };
      }
      // Too many pages: fail rather than return a silently truncated list.
      return { ok: false, code: 'UPSTREAM_ERROR', status: 0 };
    },
  };
}
