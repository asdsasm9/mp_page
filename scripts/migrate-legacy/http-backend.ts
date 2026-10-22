// HttpBackend: the live MigrationBackend (plan WP-06 sections 3.1, 3.2, 4). Supabase Auth and PostgREST
// with the anon key and the admin's own JWT, the Worker with that JWT as Bearer, presigned PUTs to R2.
// Same endpoints and trust model as apps/admin/src/adapters/real (auth, catalog, api, upload).
//
// The JWT lives only in a closure variable: never written to disk, never in an error message, never logged.
// Nothing here logs. Error messages carry codes only (no URLs, no bodies, no tokens). `fetch` is injected;
// tests pass a fake HTTP layer and never touch the network.
import {
  CommitResponseSchema,
  ErrorBodySchema,
  ReserveResponseSchema,
  StorageResponseSchema,
  type AlbumRow,
  type CategoryRow,
  type CommitRequest,
  type CommitResponse,
  type PhotoRow,
  type ReserveRequest,
  type ReserveResponse,
  type StorageResponse,
  type UploadTarget,
} from '../../packages/shared/src';
import { BackendError, type AlbumInput, type BackendErrorCode, type CategoryInput, type MigrationBackend, type UrlHistoryInput, type UrlHistoryResult } from './backend';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type Credentials = { accessToken: string };

export interface HttpBackendConfig {
  /** Supabase project URL, no trailing slash needed. */
  supabaseUrl: string;
  /** The anon key (public by design). */
  anonKey: string;
  /** Worker origin. */
  apiBaseUrl: string;
  /** Public image origin, used for HEAD in objectExists. */
  publicImgBaseUrl?: string;
  credentials: Credentials;
  fetch?: FetchLike;
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function createHttpBackend(config: HttpBackendConfig): MigrationBackend {
  const fetchFn: FetchLike = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const supabase = trimSlash(config.supabaseUrl);
  const api = trimSlash(config.apiBaseUrl);
  const imgBase = config.publicImgBaseUrl === undefined ? null : trimSlash(config.publicImgBaseUrl);
  let token: string | null = null;

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchFn(url, init);
    } catch {
      throw new BackendError('NETWORK');
    }
  }

  async function jsonOf(res: Response): Promise<unknown> {
    return res.json().catch(() => null);
  }

  /** Fallback status to code mapping shared by Supabase and Worker answers. */
  function byStatus(status: number): BackendErrorCode {
    if (status === 401) return 'UNAUTHENTICATED';
    if (status === 403) return 'NOT_ADMIN';
    if (status === 404) return 'NOT_FOUND';
    if (status === 429 || status >= 500) return 'SERVER_ERROR';
    return 'INVALID_REQUEST';
  }

  function bearer(): string {
    // No session, no request: nothing may be fetched before sign-in.
    if (token === null) throw new BackendError('UNAUTHENTICATED');
    return token;
  }

  // ---- PostgREST

  async function rest<T>(method: string, table: string, query: Record<string, string>, body?: unknown, prefer = 'return=representation'): Promise<T[]> {
    const headers: Record<string, string> = {
      apikey: config.anonKey,
      authorization: `Bearer ${bearer()}`,
      accept: 'application/json',
    };
    const init: RequestInit = { method, headers, cache: 'no-store' };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      headers.prefer = prefer;
      init.body = JSON.stringify(body);
    }
    const qs = new URLSearchParams(query).toString();
    const res = await send(`${supabase}/rest/v1/${table}${qs ? `?${qs}` : ''}`, init);
    if (!res.ok) {
      const err = await jsonOf(res);
      const pg = isObject(err) && typeof err.code === 'string' ? err.code : '';
      if (pg === '42501') throw new BackendError('NOT_ADMIN');
      if (pg === '23505') throw new BackendError('CONFLICT');
      if (pg === '23503') throw new BackendError('NOT_FOUND');
      throw new BackendError(byStatus(res.status));
    }
    const data = await jsonOf(res);
    if (!Array.isArray(data)) throw new BackendError('INTERNAL');
    return data as T[];
  }

  // ---- Worker

  async function worker(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ res: Response; json: unknown }> {
    const headers: Record<string, string> = { authorization: `Bearer ${bearer()}`, accept: 'application/json' };
    const init: RequestInit = { method, headers, cache: 'no-store' };
    if (method === 'POST') {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body ?? {});
    }
    const res = await send(`${api}${path}`, init);
    return { res, json: await jsonOf(res) };
  }

  function workerFailure(res: Response, json: unknown): BackendError {
    if (res.status >= 500 || res.status === 429) return new BackendError('SERVER_ERROR');
    const parsed = ErrorBodySchema.safeParse(json);
    if (parsed.success) return new BackendError(parsed.data.error as BackendErrorCode);
    return new BackendError(byStatus(res.status));
  }

  async function workerCall<T>(
    method: 'GET' | 'POST',
    path: string,
    schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
    body?: unknown,
  ): Promise<T> {
    const { res, json } = await worker(method, path, body);
    if (!res.ok) throw workerFailure(res, json);
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new BackendError('INTERNAL');
    return parsed.data;
  }

  // ---- Admin check

  /** POST /rest/v1/rpc/is_admin under the token; answers a JSON boolean. */
  async function isAdminRpc(): Promise<boolean> {
    const res = await send(`${supabase}/rest/v1/rpc/is_admin`, {
      method: 'POST',
      headers: { apikey: config.anonKey, authorization: `Bearer ${bearer()}`, accept: 'application/json', 'content-type': 'application/json' },
      body: '{}',
      cache: 'no-store',
    });
    if (!res.ok) throw new BackendError(byStatus(res.status));
    return (await jsonOf(res)) === true;
  }

  return {
    async signIn() {
      // The token comes from a signed-in admin session (MIGRATE_ACCESS_TOKEN). The admin check runs under it
      // before anything else can run. Fails closed.
      token = config.credentials.accessToken;
      let admin: boolean;
      try {
        admin = await isAdminRpc();
      } catch (e) {
        token = null;
        throw e;
      }
      if (!admin) {
        token = null;
        throw new BackendError('NOT_ADMIN');
      }
    },

    listCategories: () => rest<CategoryRow>('GET', 'categories', { select: '*', order: 'sort.asc,id.asc' }),

    async upsertCategory(input: CategoryInput) {
      const found = await rest<CategoryRow>('GET', 'categories', { select: '*', slug: `eq.${input.slug}`, limit: '1' });
      if (found[0]) return found[0];
      const created = await rest<CategoryRow>('POST', 'categories', {}, { id: input.id, slug: input.slug, name: input.name, sort: input.sort });
      if (!created[0]) throw new BackendError('INTERNAL');
      return created[0];
    },

    listAlbums: () => rest<AlbumRow>('GET', 'albums', { select: '*', order: 'sort.asc,id.asc' }),

    async upsertAlbum(input: AlbumInput) {
      const found = await rest<AlbumRow>('GET', 'albums', { select: '*', legacy_id: `eq.${input.legacy_id}`, limit: '1' });
      if (found[0]) return found[0];
      const created = await rest<AlbumRow>('POST', 'albums', {}, input);
      if (!created[0]) throw new BackendError('INTERNAL');
      return created[0];
    },

    async setCover(albumId, photoId) {
      const rows = await rest<AlbumRow>('PATCH', 'albums', { id: `eq.${albumId}` }, { cover_photo_id: photoId });
      if (!rows[0]) throw new BackendError('NOT_FOUND');
    },

    async addUrlHistory(rows: UrlHistoryInput[]): Promise<UrlHistoryResult> {
      const result: UrlHistoryResult = { inserted: 0, existing: 0, changed: [] };
      if (rows.length === 0) return result;
      // Direct PostgREST insert under the admin JWT: authenticated has insert on url_history behind the is_admin() policy.
      const stored = await rest<{ old_path: string; target: string | null; status: number }>('GET', 'url_history', {
        select: 'old_path,target,status',
        old_path: 'like./fotky_web/galleries/*',
        limit: '5000',
      });
      const byPath = new Map(stored.map((r) => [r.old_path, r] as const));
      const missing: UrlHistoryInput[] = [];
      for (const r of rows) {
        const found = byPath.get(r.old_path);
        if (!found) missing.push(r);
        else if (found.status === 301 && found.target === r.target) result.existing++;
        else result.changed.push({ old_path: r.old_path, found_target: found.target, found_status: found.status, wanted_target: r.target });
      }
      if (missing.length > 0) {
        // on conflict (old_path) do nothing: a concurrent run or a row added meanwhile is never overwritten.
        const created = await rest<{ old_path: string }>(
          'POST',
          'url_history',
          { on_conflict: 'old_path' },
          missing.map((r) => ({ old_path: r.old_path, target: r.target, status: 301 })),
          'resolution=ignore-duplicates,return=representation',
        );
        result.inserted = created.length;
        result.existing += missing.length - created.length;
      }
      return result;
    },

    listPhotosByLegacyKey: () => rest<PhotoRow>('GET', 'photos', { select: '*', legacy_key: 'not.is.null', order: 'sort.asc,id.asc' }),

    async reserve(request: ReserveRequest): Promise<ReserveResponse> {
      const { res, json } = await worker('POST', '/uploads/reserve', request);
      if (res.ok || res.status === 409) {
        // 409 STORAGE_FULL with the normal body shape: nothing accepted, the per-item results say why.
        const parsed = ReserveResponseSchema.safeParse(json);
        if (parsed.success) return parsed.data;
        if (res.ok) throw new BackendError('INTERNAL');
      }
      throw workerFailure(res, json);
    },

    async put(target: UploadTarget, bytes: Uint8Array) {
      // Signed headers go out exactly as issued, except content-length (the runtime sets it from the body).
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(target.headers)) {
        if (name.toLowerCase() !== 'content-length') headers[name] = value;
      }
      const res = await send(target.url, { method: target.method, headers, body: bytes as unknown as BodyInit });
      if (res.ok) return;
      if (res.status === 403) throw new BackendError('PRESIGN_EXPIRED');
      if (res.status >= 500 || res.status === 429) throw new BackendError('SERVER_ERROR');
      throw new BackendError('PUT_REJECTED');
    },

    commit: (request: CommitRequest): Promise<CommitResponse> => workerCall('POST', '/uploads/commit', CommitResponseSchema, request),

    storage: (): Promise<StorageResponse> => workerCall('GET', '/storage', StorageResponseSchema),

    async objectExists(key) {
      if (imgBase === null) throw new BackendError('CONFIG_ERROR');
      const res = await send(`${imgBase}/${key}`, { method: 'HEAD', cache: 'no-store' });
      if (res.ok) return true;
      if (res.status === 404) return false;
      throw new BackendError(byStatus(res.status));
    },
  };
}
