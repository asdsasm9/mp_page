// HttpBackend and live guards against a FAKE HTTP layer only: no real network call, no .env read.
import { describe, expect, it, vi } from 'vitest';
import { main } from '../migrate-legacy';
import { BackendError } from './backend';
import { createHttpBackend, type Credentials, type FetchLike } from './http-backend';
import { checkLive, LiveGuardError } from './live-guard';
import { tempReportDir } from './report-dir.helper';

const SENTINEL_PASSWORD = 'SENTINEL-pw-7f3a9c-do-not-print';
const SENTINEL_TOKEN = 'SENTINEL.jwt.token-91b2';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT = 'abcdefgh';
const SUPA = `https://${PROJECT}.supabase.co`;
const API = 'https://api.example.test';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** A tiny fake Supabase + Worker + R2. `isAdmin` decides the admins lookup. */
function fakeHttp(opts: { isAdmin?: boolean; authStatus?: number; extra?: (c: Call) => Response | undefined } = {}) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init) => {
    const c: Call = {
      method: init?.method ?? 'GET',
      url: input,
      headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {})),
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    calls.push(c);
    const extra = opts.extra?.(c);
    if (extra) return extra;
    if (c.url.includes('/auth/v1/token')) {
      if (opts.authStatus) return json({ error: 'invalid_grant' }, opts.authStatus);
      return json({ access_token: SENTINEL_TOKEN, user: { id: USER_ID } });
    }
    if (c.url.includes('/auth/v1/user')) return json({ id: USER_ID });
    if (c.url.includes('/rest/v1/admins')) return json(opts.isAdmin === false ? [] : [{ user_id: USER_ID }]);
    return json({ error: 'NOT_FOUND' }, 404);
  };
  return { calls, fetch };
}

const pw: Credentials = { email: 'admin@example.test', password: SENTINEL_PASSWORD };
const mk = (fetch: FetchLike, credentials: Credentials = pw) =>
  createHttpBackend({ supabaseUrl: SUPA, anonKey: 'anon-key', apiBaseUrl: API, publicImgBaseUrl: 'https://img.example.test', credentials, fetch });

const baseEnv = {
  SUPABASE_URL: SUPA,
  SUPABASE_ANON_KEY: 'anon-key',
  API_BASE_URL: API,
  MIGRATE_ADMIN_EMAIL: 'admin@example.test',
  MIGRATE_ADMIN_PASSWORD: SENTINEL_PASSWORD,
};

describe('live guards', () => {
  const ok = { confirmProject: PROJECT, allowHost: false };
  const fails = (o: Parameters<typeof checkLive>[0], env: Record<string, string | undefined>) => expect(() => checkLive(o, env)).toThrow(LiveGuardError);

  it('accepts a matching project over https', () => {
    const c = checkLive(ok, baseEnv);
    expect(c.projectLabel).toBe(PROJECT);
    expect(c.credentials).toEqual({ email: 'admin@example.test', password: SENTINEL_PASSWORD });
  });
  it('accepts a token instead of a password, and localhost over http', () => {
    const { MIGRATE_ADMIN_EMAIL: _e, MIGRATE_ADMIN_PASSWORD: _p, ...rest } = baseEnv;
    expect(checkLive(ok, { ...rest, MIGRATE_ACCESS_TOKEN: SENTINEL_TOKEN }).credentials).toEqual({ accessToken: SENTINEL_TOKEN });
    expect(checkLive({ confirmProject: 'localhost', allowHost: false }, { ...baseEnv, SUPABASE_URL: 'http://localhost:54321', API_BASE_URL: 'http://localhost:8787' }).projectLabel).toBe('localhost');
  });
  it('refuses missing or wrong confirm', () => {
    fails({ confirmProject: null, allowHost: false }, baseEnv);
    fails({ confirmProject: 'other', allowHost: false }, baseEnv);
  });
  it('refuses non-https and non-supabase hosts unless --allow-host', () => {
    fails(ok, { ...baseEnv, SUPABASE_URL: `http://${PROJECT}.supabase.co` });
    fails(ok, { ...baseEnv, API_BASE_URL: 'http://api.example.test' });
    fails({ confirmProject: 'db', allowHost: false }, { ...baseEnv, SUPABASE_URL: 'https://db.example.test' });
    expect(checkLive({ confirmProject: 'db', allowHost: true }, { ...baseEnv, SUPABASE_URL: 'https://db.example.test' }).projectLabel).toBe('db');
  });
  it('refuses URLs that carry userinfo, without echoing it', () => {
    for (const bad of [
      `https://user:pw-SECRET@${PROJECT}.supabase.co`,
      `https://user@${PROJECT}.supabase.co`,
      `https://${PROJECT}.supabase.co@evil.example`,
      `https://${PROJECT}.supabase.co:443@evil.example`,
    ]) {
      expect(() => checkLive(ok, { ...baseEnv, SUPABASE_URL: bad })).toThrow(LiveGuardError);
      expect(() => checkLive({ confirmProject: PROJECT, allowHost: true }, { ...baseEnv, SUPABASE_URL: bad })).toThrow(/credentials|label|host/);
    }
    fails(ok, { ...baseEnv, API_BASE_URL: 'https://admin:pw-SECRET@api.example.test' });
    try {
      checkLive(ok, { ...baseEnv, API_BASE_URL: 'https://admin:pw-SECRET@api.example.test' });
    } catch (e) {
      expect(String(e)).not.toContain('pw-SECRET');
    }
  });
  it('refuses look-alike hosts unless --allow-host', () => {
    for (const host of [`${PROJECT}.supabase.co.evil.example`, `${PROJECT}supabase.co`, `${PROJECT}.supabase.co.`, `evil.example/${PROJECT}.supabase.co`, 'localhost.evil.example']) {
      const label = host.split('.')[0]!.split('/')[0]!;
      fails({ confirmProject: label, allowHost: false }, { ...baseEnv, SUPABASE_URL: `https://${host}` });
    }
    // allow-host accepts it explicitly, and the confirm label is still enforced
    expect(checkLive({ confirmProject: PROJECT, allowHost: true }, { ...baseEnv, SUPABASE_URL: `https://${PROJECT}.supabase.co.evil.example` }).projectLabel).toBe(PROJECT);
    fails({ confirmProject: 'other', allowHost: true }, { ...baseEnv, SUPABASE_URL: `https://${PROJECT}.supabase.co.evil.example` });
  });
  it('normalises an upper-case host; a trailing dot is not *.supabase.co; http is localhost only', () => {
    const c = checkLive(ok, { ...baseEnv, SUPABASE_URL: `https://${PROJECT.toUpperCase()}.SUPABASE.CO` });
    expect(c.projectLabel).toBe(PROJECT);
    expect(c.supabaseUrl).toBe(SUPA);
    fails(ok, { ...baseEnv, SUPABASE_URL: `https://${PROJECT}.supabase.co.` });
    fails(ok, { ...baseEnv, SUPABASE_URL: `http://${PROJECT}.supabase.co` });
    fails({ confirmProject: 'localhost', allowHost: true }, { ...baseEnv, SUPABASE_URL: 'http://localhost.evil.example:54321' });
    expect(checkLive({ confirmProject: 'localhost', allowHost: false }, { ...baseEnv, SUPABASE_URL: 'http://LOCALHOST:54321', API_BASE_URL: 'http://127.0.0.1:8787' }).projectLabel).toBe('localhost');
  });
  it('refuses missing URL, key or credentials', () => {
    fails(ok, { ...baseEnv, SUPABASE_URL: undefined });
    fails(ok, { ...baseEnv, SUPABASE_ANON_KEY: undefined });
    fails(ok, { ...baseEnv, API_BASE_URL: undefined });
    fails(ok, { ...baseEnv, MIGRATE_ADMIN_PASSWORD: undefined });
    fails(ok, { ...baseEnv, MIGRATE_ADMIN_EMAIL: '' });
  });
  it('error messages never contain secrets', () => {
    try {
      checkLive({ confirmProject: 'wrong', allowHost: false }, baseEnv);
    } catch (e) {
      expect(String(e)).not.toContain(SENTINEL_PASSWORD);
    }
  });
});

describe('HttpBackend sign-in', () => {
  it('password grant, then admin check under the user JWT', async () => {
    const h = fakeHttp();
    await mk(h.fetch).signIn();
    expect(h.calls.map((c) => `${c.method} ${c.url.replace(SUPA, '')}`)).toEqual([
      'POST /auth/v1/token?grant_type=password',
      `GET /rest/v1/admins?select=user_id&user_id=eq.${USER_ID}&limit=1`,
    ]);
    expect(h.calls[0]!.headers.apikey).toBe('anon-key');
    expect(JSON.parse(h.calls[0]!.body!)).toEqual({ email: 'admin@example.test', password: SENTINEL_PASSWORD });
    expect(h.calls[1]!.headers.authorization).toBe(`Bearer ${SENTINEL_TOKEN}`);
  });
  it('access token path looks the user up first', async () => {
    const h = fakeHttp();
    await mk(h.fetch, { accessToken: SENTINEL_TOKEN }).signIn();
    expect(h.calls[0]!.url).toBe(`${SUPA}/auth/v1/user`);
    expect(h.calls.some((c) => c.url.includes('/auth/v1/token'))).toBe(false);
  });
  it('a non-admin fails closed with NOT_ADMIN and can then make no request', async () => {
    const h = fakeHttp({ isAdmin: false });
    const b = mk(h.fetch);
    await expect(b.signIn()).rejects.toMatchObject({ code: 'NOT_ADMIN' });
    const before = h.calls.length;
    await expect(b.reserve({ album_id: USER_ID, items: [] } as never)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(b.listAlbums()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(h.calls).toHaveLength(before);
  });
  it('wrong credentials map to UNAUTHENTICATED; transport failure to NETWORK', async () => {
    await expect(mk(fakeHttp({ authStatus: 400 }).fetch).signIn()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(mk(async () => { throw new TypeError('boom'); }).signIn()).rejects.toMatchObject({ code: 'NETWORK' });
  });
  it('nothing is requested before sign-in', async () => {
    const h = fakeHttp();
    const b = mk(h.fetch);
    await expect(b.storage()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(b.listPhotosByLegacyKey()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(h.calls).toHaveLength(0);
  });
});

describe('HttpBackend endpoints', () => {
  const signedIn = async (extra: (c: Call) => Response | undefined) => {
    const h = fakeHttp({ extra });
    const b = mk(h.fetch);
    await b.signIn();
    h.calls.length = 0;
    return { b, calls: h.calls };
  };

  it('upsertCategory returns an existing row untouched, otherwise inserts', async () => {
    const row = { id: 'x', slug: 'weddings', name: 'Svatby' };
    const a = await signedIn((c) => (c.url.includes('/rest/v1/categories') ? json([row]) : undefined));
    expect(await a.b.upsertCategory({ id: 'n', slug: 'weddings', name: 'Other', sort: 10 })).toEqual(row);
    expect(a.calls.map((c) => c.method)).toEqual(['GET']);
    const b = await signedIn((c) => (c.url.includes('/rest/v1/categories') ? json(c.method === 'GET' ? [] : [{ id: 'n' }], c.method === 'GET' ? 200 : 201) : undefined));
    expect(await b.b.upsertCategory({ id: 'n', slug: 's', name: 'N', sort: 10 })).toEqual({ id: 'n' });
    expect(b.calls[1]!.method).toBe('POST');
    expect(b.calls[1]!.headers.authorization).toBe(`Bearer ${SENTINEL_TOKEN}`);
  });
  it('never inserts photos and maps PostgREST codes', async () => {
    const { b, calls } = await signedIn((c) => (c.url.includes('/rest/v1/albums') ? json({ code: '23505' }, 409) : undefined));
    await expect(b.upsertAlbum({ id: 'i', category_id: 'c', slug: 's', title: 't', place: null, sort: 1, legacy_id: 'l', published: true })).rejects.toBeInstanceOf(BackendError);
    expect(calls.some((c) => c.url.includes('/rest/v1/photos') && c.method !== 'GET')).toBe(false);
  });
  it('addUrlHistory inserts only missing rows with on_conflict do-nothing, reports changed ones, never overwrites', async () => {
    const T = 'https://img.example.test/photos';
    const rows = [
      { old_path: '/fotky_web/galleries/a/b/1.jpg', target: `${T}/1/1600.jpg` },
      { old_path: '/fotky_web/galleries/a/b/2.jpg', target: `${T}/2/1600.jpg` },
      { old_path: '/fotky_web/galleries/a/b/3.jpg', target: `${T}/3/1600.jpg` },
    ];
    const stored = [
      { old_path: rows[0]!.old_path, target: rows[0]!.target, status: 301 },
      { old_path: rows[1]!.old_path, target: 'https://elsewhere.example/x.jpg', status: 301 },
    ];
    const { b, calls } = await signedIn((c) => {
      if (!c.url.includes('/rest/v1/url_history')) return undefined;
      return c.method === 'GET' ? json(stored) : json([{ old_path: rows[2]!.old_path }], 201);
    });
    const r = await b.addUrlHistory(rows);
    expect(r).toEqual({
      inserted: 1,
      existing: 1,
      changed: [{ old_path: rows[1]!.old_path, found_target: 'https://elsewhere.example/x.jpg', found_status: 301, wanted_target: rows[1]!.target }],
    });
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
    expect(calls[1]!.url).toBe(`${SUPA}/rest/v1/url_history?on_conflict=old_path`);
    expect(calls[1]!.headers.prefer).toContain('resolution=ignore-duplicates');
    expect(calls[1]!.headers.authorization).toBe(`Bearer ${SENTINEL_TOKEN}`);
    expect(JSON.parse(calls[1]!.body!)).toEqual([{ old_path: rows[2]!.old_path, target: rows[2]!.target, status: 301 }]);
    expect(calls.some((c) => c.method === 'PATCH' || c.method === 'DELETE')).toBe(false);

    // Everything present: no write at all.
    const all = await signedIn((c) => (c.url.includes('/rest/v1/url_history') ? json(rows.map((x) => ({ ...x, status: 301 }))) : undefined));
    expect(await all.b.addUrlHistory(rows)).toEqual({ inserted: 0, existing: 3, changed: [] });
    expect(all.calls.map((c) => c.method)).toEqual(['GET']);
  });
  it('setCover patches the album', async () => {
    const { b, calls } = await signedIn((c) => (c.method === 'PATCH' ? json([{ id: 'a' }]) : undefined));
    await b.setCover('a', 'p');
    expect(calls[0]!.url).toBe(`${SUPA}/rest/v1/albums?id=eq.a`);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ cover_photo_id: 'p' });
  });
  it('storage parses the shared schema; a bad body is INTERNAL; 5xx is SERVER_ERROR', async () => {
    const good = await signedIn((c) => (c.url.endsWith('/storage') ? json({ used_bytes: 1, reserved_bytes: 0, hard: 100, warn: 50, photo_count: 1, level: 'ok' }) : undefined));
    expect((await good.b.storage()).used_bytes).toBe(1);
    expect(good.calls[0]!.url).toBe(`${API}/storage`);
    const bad = await signedIn((c) => (c.url.endsWith('/storage') ? json({ nope: 1 }) : undefined));
    await expect(bad.b.storage()).rejects.toMatchObject({ code: 'INTERNAL' });
    const down = await signedIn((c) => (c.url.endsWith('/storage') ? json({ error: 'UPSTREAM_ERROR' }, 502) : undefined));
    await expect(down.b.storage()).rejects.toMatchObject({ code: 'SERVER_ERROR', retryable: true });
  });
  it('reserve returns the 409 STORAGE_FULL body; other errors keep the Worker code', async () => {
    const body = { items: [{ photo_id: USER_ID, ok: false, code: 'STORAGE_FULL' }], used_bytes: 100, reserved_bytes: 0, hard: 100, warn: 50, level: 'full' };
    const full = await signedIn((c) => (c.url.endsWith('/uploads/reserve') ? json(body, 409) : undefined));
    expect((await full.b.reserve({} as never)).items[0]).toMatchObject({ ok: false, code: 'STORAGE_FULL' });
    const conflict = await signedIn((c) => (c.url.endsWith('/uploads/reserve') ? json({ error: 'CONFLICT' }, 409) : undefined));
    await expect(conflict.b.reserve({} as never)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('commit maps Worker error codes', async () => {
    const { b } = await signedIn((c) => (c.url.endsWith('/uploads/commit') ? json({ error: 'BYTES_MISMATCH' }, 422) : undefined));
    await expect(b.commit({} as never)).rejects.toMatchObject({ code: 'BYTES_MISMATCH' });
  });
  it('put drops content-length, sends no auth, and maps outcomes', async () => {
    const target = { kind: 'master', key: 'k', method: 'PUT', url: 'https://r2.example.test/k?sig=1', headers: { 'content-type': 'image/jpeg', 'Content-Length': '3' }, expiresAt: 'x' } as never;
    let status = 200;
    const { b, calls } = await signedIn((c) => (c.method === 'PUT' ? new Response(null, { status }) : undefined));
    await b.put(target, new Uint8Array([1, 2, 3]));
    expect(calls[0]!.headers).toEqual({ 'content-type': 'image/jpeg' });
    status = 403;
    await expect(b.put(target, new Uint8Array(1))).rejects.toMatchObject({ code: 'PRESIGN_EXPIRED' });
    status = 400;
    await expect(b.put(target, new Uint8Array(1))).rejects.toMatchObject({ code: 'PUT_REJECTED' });
    status = 503;
    await expect(b.put(target, new Uint8Array(1))).rejects.toMatchObject({ code: 'SERVER_ERROR' });
  });
  it('objectExists uses a public HEAD', async () => {
    const { b, calls } = await signedIn((c) => (c.method === 'HEAD' ? new Response(null, { status: c.url.endsWith('/gone') ? 404 : 200 }) : undefined));
    expect(await b.objectExists('photos/a')).toBe(true);
    expect(await b.objectExists('gone')).toBe(false);
    expect(calls[0]!.headers.authorization).toBeUndefined();
  });
});

describe('migrate-legacy --live entry', () => {
  const run = async (argv: string[], env: Record<string, string | undefined>, fetch: FetchLike) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(argv, (l) => out.push(l), (l) => err.push(l), { env, fetch, reportDir: tempReportDir() });
    return { code, text: `${out.join('\n')}\n${err.join('\n')}` };
  };
  const live = ['--live', '--confirm-project', PROJECT];

  it('every guard failure exits 2 with zero requests', async () => {
    const spy = vi.fn();
    const f = spy as unknown as FetchLike;
    const cases: Array<[string[], Record<string, string | undefined>]> = [
      [['--live'], baseEnv],
      [['--live', '--confirm-project', 'wrong'], baseEnv],
      [live, { ...baseEnv, MIGRATE_ADMIN_PASSWORD: undefined }],
      [live, { ...baseEnv, SUPABASE_URL: `http://${PROJECT}.supabase.co` }],
      [live, { ...baseEnv, SUPABASE_URL: `https://${PROJECT}.example.test` }],
    ];
    for (const [argv, env] of cases) {
      const r = await run(argv, env, f);
      expect(r.code).toBe(2);
      expect(r.text).not.toContain(SENTINEL_PASSWORD);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('a non-admin stops after sign-in with no write and exit 1', async () => {
    const h = fakeHttp({ isAdmin: false });
    const r = await run(live, baseEnv, h.fetch);
    expect(r.code).toBe(1);
    expect(r.text).toContain('NOT_ADMIN');
    expect(h.calls.every((c) => c.method === 'GET' || c.url.includes('/auth/v1/token'))).toBe(true);
    expect(h.calls.some((c) => c.method !== 'GET' && !c.url.includes('/auth/v1/'))).toBe(false);
  });

  it('an admin signs in, the read-only pre-flight starts (here the fake API refuses it); sentinel password in no output', async () => {
    const h = fakeHttp();
    const r = await run(live, baseEnv, h.fetch);
    expect(r.code).toBe(1);
    expect(r.text).toContain('signed in as admin');
    expect(r.text).toContain('pre-flight failed');
    expect(h.calls.some((c) => c.url.includes('/rest/v1/photos') && c.method !== 'GET')).toBe(false);
    for (const secret of [SENTINEL_PASSWORD, SENTINEL_TOKEN]) expect(r.text).not.toContain(secret);
  });

  it('failed sign-in prints a code only', async () => {
    const r = await run(live, baseEnv, fakeHttp({ authStatus: 400 }).fetch);
    expect(r.code).toBe(1);
    expect(r.text).toContain('UNAUTHENTICATED');
    expect(r.text).not.toContain(SENTINEL_PASSWORD);
  });
});
