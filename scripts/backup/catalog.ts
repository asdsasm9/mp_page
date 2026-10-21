// Backup catalog reader (plan WP-08 section 4.3). Read-only: GET against PostgREST under the admin's own JWT,
// plus the single sign-in POST (password grant) when e-mail/password credentials are used. Same trust model
// and endpoints as scripts/migrate-legacy/http-backend.ts. `fetch` is injected; nothing here logs.
// Errors carry codes only (no URLs, bodies, tokens or credentials).
import { verifyBackupDocument, type BackupDocument } from '../../packages/shared/src';
import type { Credentials, FetchLike } from '../migrate-legacy/http-backend';

export type BackupErrorCode =
  | 'NETWORK'
  | 'UNAUTHENTICATED'
  | 'NOT_ADMIN'
  | 'SERVER_ERROR'
  | 'INVALID_REQUEST'
  | 'INTERNAL'
  | 'INVALID_DOCUMENT';

export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    /** Fixed text only (field paths and rule names), never input values. */
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'BackupError';
  }
}

export interface CatalogConfig {
  supabaseUrl: string;
  anonKey: string;
  credentials: Credentials;
  fetch?: FetchLike;
  now?: () => Date;
  /** Rows per request. Default 1000 (PostgREST default max). */
  pageSize?: number;
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

// Table name -> BackupDocument key. Names are constants, never interpolated from input.
const TABLES = [
  ['categories', 'categories'],
  ['albums', 'albums'],
  ['photos', 'photos'],
  ['url_history', 'urlHistory'],
] as const;

function byStatus(status: number): BackupErrorCode {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'NOT_ADMIN';
  if (status === 429 || status >= 500) return 'SERVER_ERROR';
  return 'INVALID_REQUEST';
}

/** Reads the four catalog tables as the signed-in admin and returns a verified BackupDocument. */
export async function readCatalog(config: CatalogConfig): Promise<BackupDocument> {
  const fetchFn: FetchLike = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const supabase = trimSlash(config.supabaseUrl);
  const pageSize = config.pageSize ?? 1000;
  let token: string | null = null;

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchFn(url, init);
    } catch {
      throw new BackupError('NETWORK');
    }
  }
  const jsonOf = (res: Response): Promise<unknown> => res.json().catch(() => null);

  async function get(path: string, query: Record<string, string>): Promise<unknown[]> {
    if (token === null) throw new BackupError('UNAUTHENTICATED');
    const qs = new URLSearchParams(query).toString();
    const res = await send(`${supabase}/rest/v1/${path}?${qs}`, {
      method: 'GET',
      headers: { apikey: config.anonKey, authorization: `Bearer ${token}`, accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new BackupError(byStatus(res.status));
    const data = await jsonOf(res);
    if (!Array.isArray(data)) throw new BackupError('INTERNAL');
    return data;
  }

  async function auth(path: string, init: RequestInit): Promise<unknown> {
    const res = await send(`${supabase}/auth/v1/${path}`, init);
    if ([400, 401, 403, 422].includes(res.status)) throw new BackupError('UNAUTHENTICATED');
    if (!res.ok) throw new BackupError(byStatus(res.status));
    return jsonOf(res);
  }

  // ---- sign in (the only non-GET request of the whole backup)
  let accessToken: string;
  let userId: string;
  const creds = config.credentials;
  if ('accessToken' in creds) {
    accessToken = creds.accessToken;
    const user = await auth('user', {
      method: 'GET',
      headers: { apikey: config.anonKey, authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    });
    if (!isObject(user) || typeof user.id !== 'string') throw new BackupError('UNAUTHENTICATED');
    userId = user.id;
  } else {
    const session = await auth('token?grant_type=password', {
      method: 'POST',
      headers: { apikey: config.anonKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email: creds.email.trim(), password: creds.password }),
    });
    if (!isObject(session) || typeof session.access_token !== 'string' || !isObject(session.user) || typeof session.user.id !== 'string') {
      throw new BackupError('UNAUTHENTICATED');
    }
    accessToken = session.access_token;
    userId = session.user.id;
  }
  token = accessToken;
  // Admin check under the user's own JWT; fails closed.
  const admin = await get('admins', { select: 'user_id', user_id: `eq.${userId}`, limit: '1' }).catch((e) => {
    token = null;
    throw e;
  });
  if (admin.length === 0) {
    token = null;
    throw new BackupError('NOT_ADMIN');
  }

  // ---- read the four tables, paged, stable order
  const out: Record<string, unknown[]> = {};
  for (const [table, key] of TABLES) {
    const rows: unknown[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await get(table, { select: '*', order: 'id.asc', limit: String(pageSize), offset: String(offset) });
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    out[key] = rows;
  }

  const verdict = verifyBackupDocument({
    schemaVersion: 1,
    generatedAt: (config.now?.() ?? new Date()).toISOString(),
    categories: out.categories,
    albums: out.albums,
    photos: out.photos,
    urlHistory: out.urlHistory,
  });
  if (!verdict.ok) {
    throw new BackupError('INVALID_DOCUMENT', verdict.issues.map((i) => `${i.path} (${i.message})`).slice(0, 10).join('; '));
  }
  return verdict.doc;
}
