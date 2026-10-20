import { readFileSync, readdirSync } from 'node:fs';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminEnv } from '../../env';
import { ApiError, AuthError, CatalogError, NetworkError } from '../../ports';
import { createRealApi } from './api';
import { createRealAuth, type SupabaseAuthLike, type SupabaseErrorLike } from './auth';
import { createRealCatalog } from './catalog';
import { createRest, type FetchFn } from './http';
import { createRealPorts } from './index';

// ---------------------------------------------------------------- helpers

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Reply = { status?: number; json?: unknown } | Error;

/** A stub fetch that records every call and answers from a queue (the last reply repeats). */
function stubFetch(...replies: Reply[]): { fetch: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const fetch: FetchFn = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const reply = replies[Math.min(i++, replies.length - 1)]!;
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.json ?? []), { status: reply.status ?? 200 });
  };
  return { fetch, calls };
}

const TOKEN = 'token-for-tests';
const ANON = 'anon-for-tests';
const BASE = 'https://project.example.test';
const WORKER = 'https://api.example.test';

const restWith = (fetch: FetchFn, getToken: () => Promise<string | null> = async () => TOKEN) =>
  createRest({ baseUrl: BASE, anonKey: ANON, getToken, fetch });

const session = (over: Partial<Session> = {}): Session =>
  ({
    access_token: TOKEN,
    refresh_token: 'refresh-for-tests',
    expires_at: 2_000_000_000,
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: 'user-1', email: 'foto@example.test' },
    ...over,
  }) as Session;

type AuthStub = SupabaseAuthLike & {
  emit(event: AuthChangeEvent, s: Session | null): void;
  calls: string[];
};

function authStub(over: Partial<SupabaseAuthLike> = {}): AuthStub {
  let callback: ((event: AuthChangeEvent, s: Session | null) => void) | null = null;
  const calls: string[] = [];
  return {
    calls,
    emit: (event, s) => callback?.(event, s),
    getSession: async () => ({ data: { session: session() }, error: null }),
    signInWithPassword: async () => ({ data: { session: session() }, error: null }),
    signOut: async (options) => {
      calls.push(`signOut:${options?.scope ?? 'default'}`);
      return { error: null };
    },
    resetPasswordForEmail: async (_email, options) => {
      calls.push(`reset:${options?.redirectTo ?? ''}`);
      return { error: null };
    },
    updateUser: async () => ({ error: null }),
    onAuthStateChange: (cb) => {
      callback = cb;
      return { data: { subscription: { unsubscribe: () => undefined } } };
    },
    ...over,
  };
}

const apiError = (status: number, code?: string): SupabaseErrorLike => ({ name: 'AuthApiError', status, ...(code ? { code } : {}) });

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------- catalog over PostgREST

describe('real catalog', () => {
  it('sends only the anon key and the session token as credentials', async () => {
    const { fetch, calls } = stubFetch({ json: [{ id: 'c1' }] });
    await createRealCatalog(restWith(fetch)).listCategories();
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0]!.headers).sort()).toEqual(['accept', 'apikey', 'authorization']);
    expect(calls[0]!.headers.apikey).toBe(ANON);
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]!.url).toBe(`${BASE}/rest/v1/categories?select=*&order=sort.asc%2Cid.asc`);
  });

  it('reads the token at call time, so a refreshed token is used at once', async () => {
    let token = 'first';
    const { fetch, calls } = stubFetch({ json: [] });
    const catalog = createRealCatalog(restWith(fetch, async () => token));
    await catalog.listCategories();
    token = 'second';
    await catalog.listCategories();
    expect(calls.map((c) => c.headers.authorization)).toEqual(['Bearer first', 'Bearer second']);
  });

  it('without a session nothing is fetched and UNAUTHENTICATED is thrown', async () => {
    const { fetch, calls } = stubFetch({ json: [] });
    const catalog = createRealCatalog(restWith(fetch, async () => null));
    await expect(catalog.listAlbums()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(catalog.updatePhoto('p1', { alt: 'x' })).rejects.toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(0);
  });

  it('an update carries the expected updated_at as a filter, URL-encoded', async () => {
    const { fetch, calls } = stubFetch({ json: [{ id: 'a1', title: 'Nový' }] });
    const row = await createRealCatalog(restWith(fetch)).updateAlbum(
      'a1',
      { title: 'Nový' },
      { expectedUpdatedAt: '2026-10-20T08:00:00.123456+00:00' },
    );
    expect(row).toMatchObject({ id: 'a1' });
    expect(calls[0]!.method).toBe('PATCH');
    expect(calls[0]!.url).toContain('id=eq.a1');
    expect(calls[0]!.url).toContain('updated_at=eq.2026-10-20T08%3A00%3A00.123456%2B00%3A00');
    expect(calls[0]!.headers.prefer).toBe('return=representation');
    expect(calls[0]!.body).toEqual({ title: 'Nový' });
  });

  it('a stale updated_at (no row matched, row still there) is STALE with the Czech text', async () => {
    const { fetch, calls } = stubFetch({ json: [] }, { json: [{ id: 'a1' }] });
    const error = await createRealCatalog(restWith(fetch))
      .updateAlbum('a1', { title: 'x' }, { expectedUpdatedAt: '2026-10-20T08:00:00+00:00' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CatalogError);
    expect((error as CatalogError).code).toBe('STALE');
    expect(calls.map((c) => c.method)).toEqual(['PATCH', 'GET']);
    const { errorMessage } = await import('../../i18n/messages');
    expect(errorMessage(error)).toBe('Toto album bylo změněno jinde. Načíst znovu.');
  });

  it('a row that is gone is NOT_FOUND, not STALE', async () => {
    const { fetch } = stubFetch({ json: [] }, { json: [] });
    await expect(
      createRealCatalog(restWith(fetch)).updateAlbum('a1', { title: 'x' }, { expectedUpdatedAt: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('photos are only read and PATCHed, and only four columns can be written', async () => {
    const { fetch, calls } = stubFetch({ json: [{ id: 'p1', updated_at: 't' }] });
    const catalog = createRealCatalog(restWith(fetch));
    await catalog.listPhotos('a1');
    await catalog.getPhoto('p1');
    await catalog.updatePhoto('p1', { alt: 'Text', caption: null, sort: 20, album_id: 'a2' }, { expectedUpdatedAt: 't' });
    expect(new Set(calls.map((c) => c.method))).toEqual(new Set(['GET', 'PATCH']));
    expect(calls.every((c) => c.url.includes('/rest/v1/photos'))).toBe(true);
    const before = calls.length;
    await expect(
      catalog.updatePhoto('p1', { bytes_total: 1 } as unknown as { alt: string }),
    ).rejects.toMatchObject({ code: 'INVALID' });
    expect(calls).toHaveLength(before);
  });

  it('maps database refusals to catalog errors', async () => {
    const cases: Array<[number, unknown, string, (c: ReturnType<typeof createRealCatalog>) => Promise<unknown>]> = [
      [409, { code: '23505' }, 'DUPLICATE_SLUG', (c) => c.createCategory({ slug: 'a', name: 'A' })],
      [409, { code: '23503' }, 'IN_USE', (c) => c.deleteCategory('c1')],
      [409, { code: '23503' }, 'NOT_FOUND', (c) => c.createAlbum({ category_id: 'x', slug: 'ab', title: 'A' })],
      [400, { code: '23514' }, 'INVALID', (c) => c.createCategory({ slug: 'a', name: 'A' })],
      [400, { code: 'P0001', message: 'COVER_NOT_IN_ALBUM' }, 'COVER_NOT_IN_ALBUM', (c) => c.updateAlbum('a1', { cover_photo_id: 'p' })],
    ];
    for (const [status, json, code, run] of cases) {
      const { fetch } = stubFetch({ status, json });
      await expect(run(createRealCatalog(restWith(fetch)))).rejects.toMatchObject({ code });
    }
  });

  it('401 is UNAUTHENTICATED, 5xx is UPSTREAM_ERROR, a failed transport is NetworkError', async () => {
    const unauthorized = stubFetch({ status: 401, json: { code: 'PGRST301' } });
    await expect(createRealCatalog(restWith(unauthorized.fetch)).listCategories()).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    const down = stubFetch({ status: 503, json: {} });
    await expect(createRealCatalog(restWith(down.fetch)).listCategories()).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      status: 503,
    });
    const offline = stubFetch(new TypeError('Failed to fetch'));
    await expect(createRealCatalog(restWith(offline.fetch)).listCategories()).rejects.toBeInstanceOf(NetworkError);
  });

  it('lists albums by category and the publish log newest first with a limit', async () => {
    const { fetch, calls } = stubFetch({ json: [] });
    const catalog = createRealCatalog(restWith(fetch));
    await catalog.listAlbums({ categoryId: 'c1' });
    await catalog.listPublishLog(10);
    expect(calls[0]!.url).toContain('category_id=eq.c1');
    expect(calls[1]!.url).toContain('order=requested_at.desc%2Cid.desc');
    expect(calls[1]!.url).toContain('limit=10');
  });
});

// ---------------------------------------------------------------- Worker

describe('real api', () => {
  const storage = { used_bytes: 1, reserved_bytes: 0, hard: 10, warn: 8, photo_count: 1, level: 'ok' };

  it('sends the Bearer token read at call time and parses the response with the shared schema', async () => {
    let token: string | null = 'one';
    const { fetch, calls } = stubFetch({ json: storage });
    const api = createRealApi({ baseUrl: WORKER, getToken: async () => token, fetch });
    expect(await api.getStorage()).toEqual(storage);
    token = 'two';
    await api.getStorage();
    expect(calls.map((c) => c.headers.authorization)).toEqual(['Bearer one', 'Bearer two']);
    expect(calls[0]!.url).toBe(`${WORKER}/storage`);
    expect(calls[0]!.method).toBe('GET');
  });

  it('does not call the Worker without a session', async () => {
    const { fetch, calls } = stubFetch({ json: storage });
    const api = createRealApi({ baseUrl: WORKER, getToken: async () => null, fetch });
    await expect(api.getStorage()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(api.publish()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(calls).toHaveLength(0);
  });

  it('turns an error body into an ApiError with status and retryAfter', async () => {
    const { fetch } = stubFetch({ status: 429, json: { error: 'PUBLISH_TOO_SOON', retryAfter: 42 } });
    const error = await createRealApi({ baseUrl: WORKER, getToken: async () => TOKEN, fetch })
      .publish()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'PUBLISH_TOO_SOON', status: 429, retryAfter: 42 });
  });

  it('a body that does not match the schema is INTERNAL; an unreadable 502 is UPSTREAM_ERROR', async () => {
    const bad = stubFetch({ json: { used_bytes: 'many' } });
    await expect(
      createRealApi({ baseUrl: WORKER, getToken: async () => TOKEN, fetch: bad.fetch }).getStorage(),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
    const gateway = stubFetch({ status: 502, json: 'oops' });
    await expect(
      createRealApi({ baseUrl: WORKER, getToken: async () => TOKEN, fetch: gateway.fetch }).getStorage(),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', status: 502 });
  });

  it('reserve returns the per-item body of a 409 and throws a plain 409 error', async () => {
    const body = {
      items: [{ photo_id: '11111111-1111-4111-8111-111111111111', ok: false, code: 'STORAGE_FULL' }],
      used_bytes: 10,
      reserved_bytes: 0,
      hard: 10,
      warn: 8,
      level: 'full',
    };
    const request = { album_id: '22222222-2222-4222-8222-222222222222', items: [] } as never;
    const normal = stubFetch({ status: 409, json: body });
    const api = createRealApi({ baseUrl: WORKER, getToken: async () => TOKEN, fetch: normal.fetch });
    expect((await api.reserve(request)).items[0]).toMatchObject({ ok: false, code: 'STORAGE_FULL' });
    expect(normal.calls[0]).toMatchObject({ method: 'POST', url: `${WORKER}/uploads/reserve` });
    expect(normal.calls[0]!.headers['content-type']).toBe('application/json');

    const refused = stubFetch({ status: 409, json: { error: 'STORAGE_FULL' } });
    await expect(
      createRealApi({ baseUrl: WORKER, getToken: async () => TOKEN, fetch: refused.fetch }).reserve(request),
    ).rejects.toMatchObject({ code: 'STORAGE_FULL' });
  });

  it('a lost connection is a NetworkError', async () => {
    const { fetch } = stubFetch(new TypeError('Failed to fetch'));
    await expect(
      createRealApi({ baseUrl: WORKER, getToken: async () => TOKEN, fetch }).getStorage(),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

// ---------------------------------------------------------------- auth

describe('real auth', () => {
  const make = (stub: AuthStub, isAdminUser = async () => true) =>
    createRealAuth(stub, { isAdminUser, redirectTo: 'https://admin.example.test/prihlaseni' });

  it('signs in and maps the session', async () => {
    const result = await make(authStub()).signIn('  foto@example.test ', 'pw');
    expect(result).toEqual({
      userId: 'user-1',
      email: 'foto@example.test',
      accessToken: TOKEN,
      expiresAt: 2_000_000_000_000,
    });
  });

  it('maps sign-in failures', async () => {
    const wrong = make(authStub({ signInWithPassword: async () => ({ data: { session: null }, error: apiError(400, 'invalid_credentials') }) }));
    await expect(wrong.signIn('a@b.cz', 'x')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    const many = make(authStub({ signInWithPassword: async () => ({ data: { session: null }, error: apiError(429, 'over_request_rate_limit') }) }));
    await expect(many.signIn('a@b.cz', 'x')).rejects.toBeInstanceOf(AuthError);
    await expect(many.signIn('a@b.cz', 'x')).rejects.toMatchObject({ code: 'TOO_MANY_ATTEMPTS' });
    const offline = make(
      authStub({
        signInWithPassword: async () => ({
          data: { session: null },
          error: { name: 'AuthRetryableFetchError', status: 0 },
        }),
      }),
    );
    await expect(offline.signIn('a@b.cz', 'x')).rejects.toBeInstanceOf(NetworkError);
    const down = make(authStub({ signInWithPassword: async () => ({ data: { session: null }, error: apiError(502) }) }));
    await expect(down.signIn('a@b.cz', 'x')).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('getSession returns null without a session and the mapped session with one', async () => {
    expect(await make(authStub({ getSession: async () => ({ data: { session: null }, error: null }) })).getSession()).toBeNull();
    expect((await make(authStub()).getSession())?.accessToken).toBe(TOKEN);
  });

  it('isAdmin asks about the signed-in user only', async () => {
    const asked: string[] = [];
    const withUser = createRealAuth(authStub(), {
      isAdminUser: async (id) => {
        asked.push(id);
        return true;
      },
    });
    expect(await withUser.isAdmin()).toBe(true);
    expect(asked).toEqual(['user-1']);
    const none = createRealAuth(authStub({ getSession: async () => ({ data: { session: null }, error: null }) }), {
      isAdminUser: async () => true,
    });
    expect(await none.isAdmin()).toBe(false);
  });

  it('sign-out falls back to clearing this browser when the server cannot be reached', async () => {
    const stub = authStub({
      signOut: async (options) => {
        stub.calls.push(`signOut:${options?.scope ?? 'default'}`);
        return { error: options ? null : { name: 'AuthRetryableFetchError', status: 0 } };
      },
    });
    await make(stub).signOut();
    expect(stub.calls).toEqual(['signOut:default', 'signOut:local']);
  });

  it('the reset answer is neutral: only a missing connection is reported', async () => {
    const stub = authStub();
    await make(stub).requestPasswordReset(' foto@example.test ');
    expect(stub.calls).toEqual(['reset:https://admin.example.test/prihlaseni']);
    const unknownAddress = make(authStub({ resetPasswordForEmail: async () => ({ error: apiError(400, 'user_not_found') }) }));
    await expect(unknownAddress.requestPasswordReset('nobody@example.test')).resolves.toBeUndefined();
    const rateLimited = make(authStub({ resetPasswordForEmail: async () => ({ error: apiError(429) }) }));
    await expect(rateLimited.requestPasswordReset('a@b.cz')).resolves.toBeUndefined();
    const offline = make(authStub({ resetPasswordForEmail: async () => ({ error: { name: 'AuthRetryableFetchError', status: 0 } }) }));
    await expect(offline.requestPasswordReset('a@b.cz')).rejects.toBeInstanceOf(NetworkError);
  });

  it('forwards sign-out and refresh events, and the recovery event even to late subscribers', async () => {
    vi.useFakeTimers();
    try {
      const stub = authStub();
      const auth = make(stub);
      const changes: Array<string | null> = [];
      auth.onAuthChange((s) => changes.push(s?.userId ?? null));
      stub.emit('SIGNED_OUT', null);
      stub.emit('TOKEN_REFRESHED', session());
      stub.emit('INITIAL_SESSION', session());
      await vi.runAllTimersAsync();
      expect(changes).toEqual([null, 'user-1']);

      stub.emit('PASSWORD_RECOVERY', session());
      const recovered = vi.fn();
      auth.onPasswordRecovery(recovered);
      await vi.runAllTimersAsync();
      expect(recovered).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('updatePassword maps a refusal to WEAK_PASSWORD', async () => {
    await expect(make(authStub()).updatePassword('long-enough-1')).resolves.toBeUndefined();
    const weak = make(authStub({ updateUser: async () => ({ error: apiError(422, 'weak_password') }) }));
    await expect(weak.updatePassword('x')).rejects.toMatchObject({ code: 'WEAK_PASSWORD' });
  });

  it('writes nothing to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
    const auth = make(authStub());
    await auth.signIn('foto@example.test', 'secret-pw');
    await auth.requestPasswordReset('foto@example.test');
    await auth.signOut();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- the assembled port set

describe('createRealPorts', () => {
  const env: AdminEnv = {
    backend: 'real',
    supabaseUrl: BASE,
    supabaseAnonKey: ANON,
    apiBaseUrl: WORKER,
    imgBaseUrl: 'https://img.example.test',
    publicSiteUrl: 'https://site.example.test',
    r2UploadOrigin: 'https://r2.example.test',
  };

  it('wires the token from getSession into the catalog, the Worker and the admin check', async () => {
    const { fetch, calls } = stubFetch({ json: [{ user_id: 'user-1' }] });
    const ports = createRealPorts(env, { auth: authStub(), fetch });
    expect(await ports.auth.isAdmin()).toBe(true);
    await ports.catalog.listCategories();
    await ports.api.getStorage().catch(() => undefined);
    expect(calls[0]!.url).toBe(`${BASE}/rest/v1/admins?select=user_id&user_id=eq.user-1&limit=1`);
    expect(calls[1]!.url.startsWith(`${BASE}/rest/v1/categories`)).toBe(true);
    expect(calls[2]!.url).toBe(`${WORKER}/storage`);
    for (const call of calls) expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('upload and publish status say "not available" until their work packages land', async () => {
    const ports = createRealPorts(env, { auth: authStub(), fetch: stubFetch({}).fetch });
    await expect(ports.upload.put({ url: 'x', method: 'PUT', headers: {} }, new Blob([]))).rejects.toThrow(
      /Připojení k serveru/,
    );
    await expect(ports.publishStatus.read()).rejects.toThrow(/Připojení k serveru/);
  });
});

// ---------------------------------------------------------------- source hygiene

describe('source hygiene', () => {
  const root = `${import.meta.dirname}/../..`;
  const files = (readdirSync(root, { recursive: true }) as string[]).filter(
    (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f),
  );
  const text = (f: string) => readFileSync(`${root}/${f}`, 'utf8');

  it('has no sign-up call, no service key and no HTML injection anywhere in src', () => {
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const source = text(f);
      // Patterns are assembled so this file does not contain the forbidden strings itself.
      expect(source, f).not.toMatch(new RegExp('sign' + 'Up\\s*\\('));
      expect(source, f).not.toMatch(new RegExp('service' + '_role', 'i'));
      expect(source, f).not.toMatch(/dangerouslySetInnerHTML|innerHTML|\beval\(|new Function/);
    }
  });

  it('never inserts into or deletes from the photos table', () => {
    const catalog = text('adapters/real/catalog.ts');
    expect(catalog).not.toMatch(/(insert|create|remove)\s*(<[^>]*>)?\(\s*'photos'/);
    expect(catalog).not.toMatch(/'photos'[^)]*\b(POST|DELETE)\b/);
  });

  it('logs nothing from the adapters, the session or the data layer', () => {
    for (const f of files.filter((x) => /^(adapters\/real|auth|data)\//.test(x))) {
      expect(text(f), f).not.toMatch(/console\./);
    }
  });
});
