/**
 * Shared plumbing of the real adapters: an injectable fetch (tests pass a stub), the access token read
 * at call time, and the PostgREST helper used by the catalog and the admin check. Nothing here logs.
 */
import { ApiError, CatalogError, NetworkError } from '../../ports';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Resolves the current access token (supabase-js getSession at call time), or null without a session. */
export type TokenSource = () => Promise<string | null>;

export const defaultFetch: FetchFn = (input, init) => globalThis.fetch(input, init);

/** fetch that turns every transport failure (offline, DNS, CORS, reset) into NetworkError. */
export async function send(fetchFn: FetchFn, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchFn(url, init);
  } catch {
    throw new NetworkError();
  }
}

export interface RestConfig {
  /** Supabase project URL without a trailing slash. */
  baseUrl: string;
  /** The anon key: the only key that ever reaches the browser. */
  anonKey: string;
  getToken: TokenSource;
  fetch?: FetchFn;
}

type Query = Record<string, string>;

export interface Rest {
  select<T>(table: string, query: Query): Promise<T[]>;
  insert<T>(table: string, body: unknown): Promise<T[]>;
  patch<T>(table: string, query: Query, body: unknown): Promise<T[]>;
  remove(table: string, query: Query): Promise<void>;
}

function field(body: unknown, name: string): string {
  if (body && typeof body === 'object') {
    const v = (body as Record<string, unknown>)[name];
    if (typeof v === 'string') return v;
  }
  return '';
}

/** PostgREST / Postgres refusal to the port's error vocabulary. Never carries input or messages along. */
export async function restError(res: Response, method: string): Promise<Error> {
  const body: unknown = await res.json().catch(() => null);
  const pg = field(body, 'code');
  const text = `${field(body, 'message')} ${field(body, 'details')}`;
  if (res.status === 401) return new ApiError('UNAUTHENTICATED');
  if (res.status === 403 && pg !== '42501') return new ApiError('NOT_ADMIN');
  if (res.status === 429 || res.status >= 500) return new ApiError('UPSTREAM_ERROR', { status: res.status });
  if (text.includes('COVER_NOT_IN_ALBUM')) return new CatalogError('COVER_NOT_IN_ALBUM');
  if (pg === '42501') return new ApiError('NOT_ADMIN');
  if (pg === '23505') return new CatalogError('DUPLICATE_SLUG');
  if (pg === '23503') return new CatalogError(method === 'DELETE' ? 'IN_USE' : 'NOT_FOUND');
  if (res.status === 404) return new CatalogError('NOT_FOUND');
  return new CatalogError('INVALID');
}

export function createRest(config: RestConfig): Rest {
  const fetchFn = config.fetch ?? defaultFetch;

  async function call(method: string, table: string, query: Query, body?: unknown): Promise<Response> {
    const token = await config.getToken();
    // No session, no request: nothing may be fetched before sign-in.
    if (!token) throw new ApiError('UNAUTHENTICATED');
    const headers: Record<string, string> = {
      apikey: config.anonKey,
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    };
    const init: RequestInit = { method, headers, cache: 'no-store' };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      headers.prefer = 'return=representation';
      init.body = JSON.stringify(body);
    }
    const qs = new URLSearchParams(query).toString();
    const res = await send(fetchFn, `${config.baseUrl}/rest/v1/${table}${qs ? `?${qs}` : ''}`, init);
    if (!res.ok) throw await restError(res, method);
    return res;
  }

  const rows = async <T>(res: Response): Promise<T[]> => {
    const data: unknown = await res.json().catch(() => null);
    if (!Array.isArray(data)) throw new ApiError('INTERNAL');
    return data as T[];
  };

  return {
    async select<T>(table: string, query: Query) {
      return rows<T>(await call('GET', table, query));
    },
    async insert<T>(table: string, body: unknown) {
      return rows<T>(await call('POST', table, {}, body));
    },
    async patch<T>(table: string, query: Query, body: unknown) {
      return rows<T>(await call('PATCH', table, query, body));
    },
    async remove(table: string, query: Query) {
      await call('DELETE', table, query);
    },
  };
}
