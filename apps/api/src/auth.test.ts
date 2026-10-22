import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type Route } from './index';
import { isTokenShapeValid } from './auth';
import { jsonResponse, withBaseHeaders } from './http';
import { ADMIN, goodEnv } from './test-support';

const ADMIN_TOKEN = 'aaaaaaaa.bbbbbbbb.admin1';
const USER_TOKEN = 'aaaaaaaa.bbbbbbbb.user22';
const UNKNOWN_TOKEN = 'aaaaaaaa.bbbbbbbb.nobody';
const OUTAGE_TOKEN = 'aaaaaaaa.bbbbbbbb.outage';
const SLOW_TOKEN = 'aaaaaaaa.bbbbbbbb.slow11';

let upstream: Array<{ url: string; auth: string | null; apikey: string | null }>;
const fakeFetch = vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  const auth = headers.get('authorization');
  upstream.push({ url: String(input), auth, apikey: headers.get('apikey') });
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  if (auth === `Bearer ${ADMIN_TOKEN}`) return reply(true);
  if (auth === `Bearer ${USER_TOKEN}`) return reply(false);
  if (auth === `Bearer ${OUTAGE_TOKEN}`) return reply({ message: 'db down' }, 500);
  if (auth === `Bearer ${SLOW_TOKEN}`) {
    return new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('t'))));
  }
  return reply({ message: 'JWT invalid' }, 401);
});

let reached = 0;
const secured: Route = {
  methods: ['GET'],
  handler: ({ jwt }) => {
    reached++;
    return jsonResponse({ ok: true, jwtSeen: jwt === ADMIN_TOKEN }, 200);
  },
};
const app = createApp({ routes: { '/secured': secured }, fetch: fakeFetch, env: {} });
const call = (headers: Record<string, string> = {}, path = '/secured') =>
  app.fetch(new Request(`https://api.test${path}`, { headers }), goodEnv());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

let warn: ReturnType<typeof vi.spyOn>;
let err: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  upstream = [];
  reached = 0;
  fakeFetch.mockClear();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
  err.mockRestore();
  log.mockRestore();
});

describe('shape check, zero upstream calls', () => {
  const cases: Array<[string, Record<string, string>]> = [
    ['no header', {}],
    ['wrong scheme', { authorization: `Basic ${ADMIN_TOKEN}` }],
    ['no scheme', { authorization: ADMIN_TOKEN }],
    ['two-part token', bearer('aaaaaaaa.bbbbbbbb')],
    ['four-part token', bearer('a.b.c.d')],
    ['empty part', bearer('aaaa..cccc')],
    ['bad characters', bearer('aaaa.bb bb.cccc')],
    ['over-long token', bearer(`aaaa.bbbb.${'c'.repeat(4096)}`)],
    ['token at 4097 chars', bearer(`${'a'.repeat(4093)}.b.c`)],
    ['empty bearer', { authorization: 'Bearer ' }],
  ];
  it.each(cases)('%s gives 401 UNAUTHENTICATED', async (_n, headers) => {
    const res = await call(headers);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'UNAUTHENTICATED' });
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(reached).toBe(0);
  });

  it('shape helper accepts exactly 4096 characters', () => {
    expect(isTokenShapeValid(`${'a'.repeat(4092)}.b.c`)).toBe(true);
    expect(isTokenShapeValid(`${'a'.repeat(4093)}.b.c`)).toBe(false);
  });
});

describe('upstream decisions', () => {
  it('unknown token gives 401', async () => {
    const res = await call(bearer(UNKNOWN_TOKEN));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'UNAUTHENTICATED' });
    expect(reached).toBe(0);
  });

  it('valid non-admin gives 403 NOT_ADMIN', async () => {
    const res = await call(bearer(USER_TOKEN));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'NOT_ADMIN' });
    expect(reached).toBe(0);
  });

  it('admin continues and the handler gets the JWT', async () => {
    const res = await call(bearer(ADMIN_TOKEN));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, jwtSeen: true });
    expect(upstream).toEqual([
      { url: 'https://abcdefgh.supabase.co/rest/v1/rpc/is_admin', auth: `Bearer ${ADMIN_TOKEN}`, apikey: 'anon-test-key-value' },
    ]);
  });

  it('scheme is case-insensitive', async () => {
    const res = await call({ authorization: `bearer ${ADMIN_TOKEN}` });
    expect(res.status).toBe(200);
  });

  it('Supabase 500 fails closed with 503', async () => {
    const res = await call(bearer(OUTAGE_TOKEN));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'UPSTREAM_ERROR' });
    expect(reached).toBe(0);
  });

  it('a network error fails closed with 503', async () => {
    const a = createApp({
      routes: { '/secured': secured },
      fetch: () => Promise.reject(new TypeError('network')),
    });
    const res = await a.fetch(new Request('https://api.test/secured', { headers: bearer(ADMIN_TOKEN) }), goodEnv());
    expect(res.status).toBe(503);
    expect(reached).toBe(0);
  });

  it('a timeout fails closed with 503', async () => {
    vi.useFakeTimers();
    try {
      const p = call(bearer(SLOW_TOKEN));
      await vi.advanceTimersByTimeAsync(9000);
      const res = await p;
      expect(res.status).toBe(503);
      expect(reached).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an unexpected is_admin result fails closed', async () => {
    const a = createApp({
      routes: { '/secured': secured },
      fetch: async () => new Response('"yes"', { status: 200 }),
    });
    const res = await a.fetch(new Request('https://api.test/secured', { headers: bearer(ADMIN_TOKEN) }), goodEnv());
    expect(res.status).toBe(503);
    expect(reached).toBe(0);
  });
});

describe('pipeline order', () => {
  it('/health needs no token and makes no upstream call', async () => {
    const res = await call({}, '/health');
    expect(res.status).toBe(200);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('preflight is answered before auth', async () => {
    const res = await app.fetch(
      new Request('https://api.test/secured', {
        method: 'OPTIONS',
        headers: { origin: ADMIN, 'access-control-request-method': 'GET' },
      }),
      goodEnv(),
    );
    expect(res.status).toBe(204);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('auth failures still carry base and CORS headers', async () => {
    const res = await call({ origin: ADMIN });
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe(ADMIN);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('no token in output', () => {
  it.each([
    ['unknown token', UNKNOWN_TOKEN],
    ['non-admin', USER_TOKEN],
    ['outage', OUTAGE_TOKEN],
  ])('%s: logs and body contain neither token nor header', async (_n, token) => {
    const res = await call(bearer(token));
    const body = await res.text();
    const logged = JSON.stringify([warn.mock.calls, err.mock.calls, log.mock.calls]);
    for (const out of [body, logged]) {
      expect(out).not.toContain(token);
      expect(out.toLowerCase()).not.toContain('authorization');
      expect(out).not.toContain('Bearer');
    }
  });

  it('a malformed token is not logged either', async () => {
    const bad = 'secret-garbage-token';
    const res = await call(bearer(bad));
    expect(await res.text()).not.toContain(bad);
    expect(JSON.stringify([warn.mock.calls, err.mock.calls, log.mock.calls])).not.toContain(bad);
  });
});

describe('withBaseHeaders', () => {
  it('does not mutate an immutable response and keeps the body', async () => {
    const immutable = Response.redirect('https://example.com/', 302); // headers are immutable
    expect(() => immutable.headers.set('x', 'y')).toThrow();
    const out = withBaseHeaders(immutable);
    expect(out.status).toBe(302);
    expect(out.headers.get('cache-control')).toBe('no-store');
    expect(immutable.headers.get('cache-control')).toBeNull();

    const orig = new Response('hello', { status: 201, headers: { vary: 'Accept-Encoding' } });
    const wrapped = withBaseHeaders(orig);
    expect(wrapped.status).toBe(201);
    expect(wrapped.headers.get('vary')).toBe('Accept-Encoding, Origin');
    expect(orig.headers.get('vary')).toBe('Accept-Encoding');
    expect(await wrapped.text()).toBe('hello');
  });
});
