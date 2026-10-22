import { readFileSync, readdirSync } from 'node:fs';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminEnv } from '../../env';
import { ApiError, AuthError, CatalogError, NetworkError, UploadAbortedError } from '../../ports';
import { createRealApi } from './api';
import { createRealAuth, type SupabaseAuthLike, type SupabaseErrorLike } from './auth';
import { createRealCatalog } from './catalog';
import { createRest, type FetchFn } from './http';
import { createRealPublishStatus } from './publishStatus';
import { createRealPorts } from './index';
import { createXhrUpload } from './upload';

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
  oauth: unknown[];
};

function authStub(over: Partial<SupabaseAuthLike> = {}): AuthStub {
  let callback: ((event: AuthChangeEvent, s: Session | null) => void) | null = null;
  const calls: string[] = [];
  const oauth: unknown[] = [];
  return {
    calls,
    oauth,
    signInWithOAuth: async (credentials) => {
      oauth.push(credentials);
      return { data: {}, error: null };
    },
    emit: (event, s) => callback?.(event, s),
    getSession: async () => ({ data: { session: session() }, error: null }),
    signOut: async (options) => {
      calls.push(`signOut:${options?.scope ?? 'default'}`);
      return { error: null };
    },
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

  it('getSession returns null without a session and the mapped session with one', async () => {
    expect(await make(authStub({ getSession: async () => ({ data: { session: null }, error: null }) })).getSession()).toBeNull();
    expect(await make(authStub()).getSession()).toEqual({
      userId: 'user-1',
      email: 'foto@example.test',
      accessToken: TOKEN,
      expiresAt: 2_000_000_000_000,
    });
  });

  it('getSession reports a missing connection as NetworkError', async () => {
    const offline = make(
      authStub({ getSession: async () => ({ data: { session: null }, error: { name: 'AuthRetryableFetchError', status: 0 } }) }),
    );
    await expect(offline.getSession()).rejects.toBeInstanceOf(NetworkError);
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

  it('forwards sign-out and refresh events', async () => {
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
    } finally {
      vi.useRealTimers();
    }
  });

  it('writes nothing to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
    const auth = make(authStub());
    await auth.getSession();
    await auth.isAdmin();
    await auth.signOut();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- Google sign-in

describe('real auth: Google sign-in', () => {
  const REDIRECT = `${location.origin}/prihlaseni`;
  const at = (path: string) => history.replaceState(null, '', path);
  const make = (stub: AuthStub = authStub()) => createRealAuth(stub, { isAdminUser: async () => true });
  afterEach(() => at('/'));

  it('starts the OAuth flow for google with redirectTo = origin + /prihlaseni and only prompt as query param', async () => {
    const stub = authStub();
    await make(stub).signInWithGoogle({ returnTo: '/zverejnit' });
    expect(stub.oauth).toEqual([
      { provider: 'google', options: { redirectTo: REDIRECT, queryParams: { prompt: 'select_account' } } },
    ]);
  });

  it('passes login_hint only when one is given', async () => {
    const stub = authStub();
    await make(stub).signInWithGoogle({ returnTo: '/', loginHint: 'foto@example.test' });
    expect(stub.oauth[0]).toEqual({
      provider: 'google',
      options: { redirectTo: REDIRECT, queryParams: { prompt: 'select_account', login_hint: 'foto@example.test' } },
    });
  });

  it('sends no scopes and no query params beyond prompt and login_hint (fails if any are added)', async () => {
    const stub = authStub();
    const auth = make(stub);
    await auth.signInWithGoogle({ returnTo: '/' });
    await auth.signInWithGoogle({ returnTo: '/', loginHint: 'foto@example.test' });
    for (const call of stub.oauth as Array<{ provider: string; options: Record<string, unknown> }>) {
      expect(Object.keys(call).sort()).toEqual(['options', 'provider']);
      expect(Object.keys(call.options).sort()).toEqual(['queryParams', 'redirectTo']);
      expect('scopes' in call.options).toBe(false);
      const extra = Object.keys(call.options.queryParams as object).filter((k) => !['prompt', 'login_hint'].includes(k));
      expect(extra).toEqual([]);
    }
  });

  it('does not store or forward returnTo itself (the session layer owns it)', async () => {
    const stub = authStub();
    await make(stub).signInWithGoogle({ returnTo: '/zverejnit' });
    expect(JSON.stringify(stub.oauth)).not.toContain('zverejnit');
    expect(sessionStorage.length).toBe(0);
  });

  it('uses the configured redirectTo when given', async () => {
    const stub = authStub();
    await createRealAuth(stub, { isAdminUser: async () => true, redirectTo: 'https://admin.example.test/prihlaseni' }).signInWithGoogle({
      returnTo: '/',
    });
    expect((stub.oauth[0] as { options: { redirectTo: string } }).options.redirectTo).toBe('https://admin.example.test/prihlaseni');
  });

  it('maps start failures: offline, rate limit, upstream', async () => {
    const failing = (error: SupabaseErrorLike) => make(authStub({ signInWithOAuth: async () => ({ data: {}, error }) }));
    await expect(failing({ name: 'AuthRetryableFetchError', status: 0 }).signInWithGoogle({ returnTo: '/' })).rejects.toBeInstanceOf(NetworkError);
    await expect(failing(apiError(429)).signInWithGoogle({ returnTo: '/' })).rejects.toMatchObject({ code: 'TOO_MANY_ATTEMPTS' });
    await expect(failing(apiError(400)).signInWithGoogle({ returnTo: '/' })).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('success: a clean URL gives no callback error', () => {
    at('/prihlaseni?code=abc');
    expect(make().takeCallbackError()).toBeNull();
    expect(location.search).toBe('?code=abc');
  });

  it.each([
    ['access_denied alone (cancelled at Google)', '?error=access_denied&error_description=x', 'CANCELLED'],
    ['access_denied with signup_disabled', '?error=access_denied&error_code=signup_disabled&error_description=x', 'NOT_ALLOWED'],
    ['signup_disabled code only', '?error_code=signup_disabled', 'NOT_ALLOWED'],
    ['server_error / unknown code', '?error=server_error&error_code=unexpected_failure&error_description=x', 'FAILED'],
    ['unknown code that looks like a cancel', '?error=weird&error_code=brand_new_code', 'FAILED'],
    ['description only', '?error_description=something', 'FAILED'],
  ])('callback in the query: %s', (_name, search, expected) => {
    at(`/prihlaseni${search}`);
    const auth = make();
    expect(auth.takeCallbackError()).toBe(expected);
  });

  it('callback in the hash is read too, and the query wins when both are present', () => {
    at('/prihlaseni#error=access_denied&error_code=signup_disabled&error_description=x');
    expect(make().takeCallbackError()).toBe('NOT_ALLOWED');
    at('/prihlaseni?error=access_denied#error=server_error&error_code=signup_disabled');
    // error from the query (access_denied), error_code only in the hash: the codes are read per parameter.
    expect(make().takeCallbackError()).toBe('NOT_ALLOWED');
    at('/prihlaseni?error_code=other#error_code=signup_disabled&error=access_denied');
    expect(make().takeCallbackError()).toBe('CANCELLED');
  });

  it('the error is returned once, and the URL is cleaned of exactly the three parameters', () => {
    at('/prihlaseni?error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed&keep=1#error=x&frag=2');
    const state = { marker: true };
    history.replaceState(state, '', location.href);
    const auth = make();
    expect(location.pathname).toBe('/prihlaseni');
    expect(location.search).toBe('?keep=1');
    expect(location.hash).toBe('#frag=2');
    expect(history.state).toEqual(state);
    expect(auth.takeCallbackError()).toBe('NOT_ALLOWED');
    expect(auth.takeCallbackError()).toBeNull();
  });

  it('a fully cleaned URL has neither query nor hash left', () => {
    at('/prihlaseni?error=access_denied&error_code=signup_disabled&error_description=x#error=access_denied');
    make();
    expect(location.href).toBe(`${location.origin}/prihlaseni`);
  });

  it('writes nothing to the console and shows no code or description in any output', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
    at('/prihlaseni?error=access_denied&error_code=signup_disabled&error_description=secret-description');
    const auth = make();
    auth.takeCallbackError();
    await auth.signInWithGoogle({ returnTo: '/', loginHint: 'foto@example.test' });
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
    const { fetch, calls } = stubFetch({ json: true }, { json: [] });
    const ports = createRealPorts(env, { auth: authStub(), fetch });
    expect(await ports.auth.isAdmin()).toBe(true);
    await ports.catalog.listCategories();
    await ports.api.getStorage().catch(() => undefined);
    expect(calls[0]!.url).toBe(`${BASE}/rest/v1/rpc/is_admin`);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.body).toEqual({});
    expect(calls[1]!.url.startsWith(`${BASE}/rest/v1/categories`)).toBe(true);
    expect(calls[2]!.url).toBe(`${WORKER}/storage`);
    for (const call of calls) expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('isAdmin is the is_admin RPC result: false stays false, a refusal is false, a 401 is thrown', async () => {
    const no = createRealPorts(env, { auth: authStub(), fetch: stubFetch({ json: false }).fetch });
    expect(await no.auth.isAdmin()).toBe(false);
    const refused = createRealPorts(env, { auth: authStub(), fetch: stubFetch({ status: 403, json: { code: '42501' } }).fetch });
    expect(await refused.auth.isAdmin()).toBe(false);
    const expired = createRealPorts(env, { auth: authStub(), fetch: stubFetch({ status: 401, json: {} }).fetch });
    await expect(expired.auth.isAdmin()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('the upload port is the XHR one and the publish status reads the public site', async () => {
    const reply = { snapshotGeneratedAt: '2026-10-20T08:00:00.000Z', builtAt: '2026-10-20T08:01:30.000Z', counts: { categories: 1, albums: 2, photos: 3 } };
    const { fetch, calls } = stubFetch({ json: reply });
    const ports = createRealPorts(env, { auth: authStub(), fetch });
    expect(typeof ports.upload.put).toBe('function');
    await expect(ports.publishStatus.read()).resolves.toEqual(reply);
    expect(calls[0]!.url).toBe('https://site.example.test/_publish.json');
  });
});

describe('real publish status', () => {
  const SITE = 'https://site.example.test/';
  const good = { snapshotGeneratedAt: '2026-10-20T08:00:00.000Z', builtAt: '2026-10-20T08:01:30.000Z', counts: { categories: 1, albums: 2, photos: 3 } };

  it('asks with cache no-store, no credentials and no token, on the trimmed site URL', async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const fetch: FetchFn = async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify(good), { status: 200 });
    };
    await createRealPublishStatus({ siteUrl: SITE, fetch }).read();
    expect(seen[0]!.url).toBe('https://site.example.test/_publish.json');
    expect(seen[0]!.init).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'omit' });
    expect(JSON.stringify(seen[0]!.init)).not.toMatch(/authorization|bearer/i);
  });

  it('404 is null; a transport failure (CORS), a 5xx and a non-JSON body are NetworkError', async () => {
    const read = (reply: Reply | (() => Response)) =>
      createRealPublishStatus({
        siteUrl: SITE,
        fetch: async () => {
          if (typeof reply === 'function') return reply();
          if (reply instanceof Error) throw reply;
          return new Response(JSON.stringify(reply.json ?? {}), { status: reply.status ?? 200 });
        },
      }).read();
    await expect(read({ status: 404 })).resolves.toBeNull();
    await expect(read(new TypeError('Failed to fetch'))).rejects.toBeInstanceOf(NetworkError);
    await expect(read({ status: 503 })).rejects.toBeInstanceOf(NetworkError);
    await expect(read(() => new Response('<html>', { status: 200 }))).rejects.toBeInstanceOf(NetworkError);
    await expect(read({ json: { builtAt: 'x' } })).rejects.toBeInstanceOf(NetworkError);
  });
});

// ---------------------------------------------------------------- app_config and the XHR upload port

describe('real catalog getAppConfig', () => {
  it('reads the single app_config row under the user JWT', async () => {
    const row = { id: true, quota_hard_bytes: 9, quota_warn_bytes: 8, max_upload_bytes: 7, max_files_per_batch: 6, reservation_ttl_min: 5 };
    const { fetch, calls } = stubFetch({ json: [row] });
    expect(await createRealCatalog(restWith(fetch)).getAppConfig()).toEqual(row);
    expect(calls[0]!.url).toBe(`${BASE}/rest/v1/app_config?select=*&limit=1`);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('NOT_FOUND without a row, and no request without a session', async () => {
    await expect(createRealCatalog(restWith(stubFetch({ json: [] }).fetch)).getAppConfig()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const stub = stubFetch({ json: [] });
    await expect(createRealCatalog(restWith(stub.fetch, async () => null)).getAppConfig()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(stub.calls).toHaveLength(0);
  });
});

describe('real api commit signal', () => {
  it('passes the abort signal to fetch', async () => {
    const seen: Array<AbortSignal | null | undefined> = [];
    const fetch: FetchFn = async (_url, init) => {
      seen.push(init?.signal);
      throw new TypeError('aborted');
    };
    const api = createRealApi({ baseUrl: WORKER, getToken: async () => TOKEN, fetch });
    const controller = new AbortController();
    await expect(api.commit({} as never, { signal: controller.signal })).rejects.toBeInstanceOf(NetworkError);
    expect(seen[0]).toBe(controller.signal);
  });
});

class FakeXhr {
  static last: FakeXhr;
  method = '';
  url = '';
  status = 0;
  headers: Array<[string, string]> = [];
  sent: unknown = undefined;
  aborted = false;
  upload: { onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers.push([name, value]);
  }
  send(body: unknown) {
    this.sent = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}
const xhrPort = () => createXhrUpload(() => new FakeXhr() as unknown as XMLHttpRequest);
const signed = {
  url: 'https://r2.example.test/photos/x/master.jpg?sig=1',
  method: 'PUT' as const,
  headers: { 'content-type': 'image/jpeg', 'content-length': '3', 'cache-control': 'public, max-age=31536000, immutable' },
};

describe('real upload (XHR)', () => {
  it('sends the signed headers unchanged except content-length, reports progress and resolves on 2xx', async () => {
    const progress: Array<[number, number]> = [];
    const body = new Blob(['abc']);
    const done = xhrPort().put(signed, body, { onProgress: (l, t) => progress.push([l, t]) });
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe(signed.url);
    expect(xhr.headers).toEqual([
      ['content-type', 'image/jpeg'],
      ['cache-control', 'public, max-age=31536000, immutable'],
    ]);
    expect(xhr.headers.some(([n]) => n.toLowerCase() === 'content-length')).toBe(false);
    expect(xhr.sent).toBe(body);
    xhr.upload.onprogress?.({ loaded: 1, total: 3, lengthComputable: true });
    xhr.status = 200;
    xhr.onload?.();
    await done;
    expect(progress).toEqual([
      [1, 3],
      [3, 3],
    ]);
  });

  it('maps 403 to UploadHttpError, transport failure to NetworkError and abort to UploadAbortedError', async () => {
    const forbidden = xhrPort().put(signed, new Blob(['abc']));
    FakeXhr.last.status = 403;
    FakeXhr.last.onload?.();
    await expect(forbidden).rejects.toMatchObject({ status: 403 });

    const offline = xhrPort().put(signed, new Blob(['abc']));
    FakeXhr.last.onerror?.();
    await expect(offline).rejects.toBeInstanceOf(NetworkError);

    const controller = new AbortController();
    const cancelled = xhrPort().put(signed, new Blob(['abc']), { signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toBeInstanceOf(UploadAbortedError);
    expect(FakeXhr.last.aborted).toBe(true);

    controller.abort();
    await expect(xhrPort().put(signed, new Blob(['abc']), { signal: controller.signal })).rejects.toBeInstanceOf(UploadAbortedError);
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

  it('creates the supabase client with the PKCE flow, session persistence, refresh and URL detection', () => {
    const index = text('adapters/real/index.ts');
    expect(index).toMatch(/flowType:\s*'pkce'/);
    expect(index).toMatch(/persistSession:\s*true/);
    expect(index).toMatch(/autoRefreshToken:\s*true/);
    expect(index).toMatch(/detectSessionInUrl:\s*true/);
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
