/**
 * Real ApiPort: the Worker over fetch. The Bearer token is read from the session at call time (so a
 * refreshed token is used at once and nothing is cached here); without a session no request is sent.
 * Every success body is parsed with the shared zod schema; an error body becomes an ApiError.
 */
import {
  CommitResponseSchema,
  DeleteResponseSchema,
  ErrorBodySchema,
  PublishResponseSchema,
  ReconcileResponseSchema,
  ReserveResponseSchema,
  StorageResponseSchema,
  type ReserveResponse,
} from '@mp/shared';
import { ApiError, type ApiPort } from '../../ports';
import { defaultFetch, send, type FetchFn, type TokenSource } from './http';

export interface RealApiConfig {
  /** Worker base URL without a trailing slash. */
  baseUrl: string;
  getToken: TokenSource;
  fetch?: FetchFn;
}

interface Parser<T> {
  parse(input: unknown): T;
}

export function createRealApi(config: RealApiConfig): ApiPort {
  const fetchFn = config.fetch ?? defaultFetch;

  async function raw(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<{ res: Response; json: unknown }> {
    const token = await config.getToken();
    if (!token) throw new ApiError('UNAUTHENTICATED');
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json' };
    const init: RequestInit = { method, headers, cache: 'no-store', ...(signal ? { signal } : {}) };
    if (method === 'POST') {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body ?? {});
    }
    const res = await send(fetchFn, `${config.baseUrl}${path}`, init);
    const json: unknown = await res.json().catch(() => null);
    return { res, json };
  }

  function failure(res: Response, json: unknown): ApiError {
    const parsed = ErrorBodySchema.safeParse(json);
    if (parsed.success) {
      return new ApiError(parsed.data.error as ConstructorParameters<typeof ApiError>[0], {
        status: res.status,
        ...(parsed.data.retryAfter === undefined ? {} : { retryAfter: parsed.data.retryAfter }),
      });
    }
    if (res.status === 401) return new ApiError('UNAUTHENTICATED');
    if (res.status >= 500) return new ApiError('UPSTREAM_ERROR', { status: res.status });
    return new ApiError('INTERNAL', { status: res.status });
  }

  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    schema: Parser<T>,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const { res, json } = await raw(method, path, body, signal);
    if (!res.ok) throw failure(res, json);
    try {
      return schema.parse(json);
    } catch {
      throw new ApiError('INTERNAL', { status: res.status });
    }
  }

  return {
    getStorage: () => request('GET', '/storage', StorageResponseSchema),
    async reserve(request_): Promise<ReserveResponse> {
      const { res, json } = await raw('POST', '/uploads/reserve', request_);
      if (res.ok) {
        try {
          return ReserveResponseSchema.parse(json);
        } catch {
          throw new ApiError('INTERNAL', { status: res.status });
        }
      }
      // 409 STORAGE_FULL with the normal body shape: nothing accepted, the per-item results say why.
      if (res.status === 409) {
        const normal = ReserveResponseSchema.safeParse(json);
        if (normal.success) return normal.data;
      }
      throw failure(res, json);
    },
    commit: (body, options) => request('POST', '/uploads/commit', CommitResponseSchema, body, options?.signal),
    deletePhotos: (body) => request('POST', '/photos/delete', DeleteResponseSchema, body),
    reconcile: (body) => request('POST', '/storage/reconcile', ReconcileResponseSchema, body),
    publish: () => request('POST', '/publish', PublishResponseSchema, {}),
  };
}
