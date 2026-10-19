import { describe, expect, it } from 'vitest';
import { createApp, type Route } from './index';
import { jsonResponse } from './http';
import { applyCors, checkOrigin } from './cors';
import { ADMIN, goodEnv } from './test-support';

// Stand-in for an authenticated route: CORS must answer preflight without ever reaching it.
let handlerCalls = 0;
const guarded: Route = {
  methods: ['GET', 'POST'],
  auth: false, // auth is covered in auth.test.ts; here only CORS matters
  handler: () => {
    handlerCalls++;
    return jsonResponse({ ok: true }, 200);
  },
};
const app = createApp({ routes: { '/guarded': guarded } });
const call = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  app.fetch(new Request(`https://api.test${path}`, init), goodEnv());

const LOCAL = 'http://localhost:5173';

describe('CORS allowed origins', () => {
  it.each([ADMIN, LOCAL])('reflects %s exactly with Vary: Origin', async (origin) => {
    const res = await call('/guarded', { headers: { origin } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    expect(res.headers.get('vary')).toContain('Origin');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.has('access-control-allow-credentials')).toBe(false);
  });

  it('error responses for an allowed origin carry the CORS header too', async () => {
    const res = await call('/nope', { headers: { origin: ADMIN } });
    expect(res.status).toBe(404);
    expect(res.headers.get('access-control-allow-origin')).toBe(ADMIN);
  });

  it('a request without Origin proceeds, with no CORS header', async () => {
    const before = handlerCalls;
    const res = await call('/guarded');
    expect(res.status).toBe(200);
    expect(handlerCalls).toBe(before + 1);
    expect(res.headers.has('access-control-allow-origin')).toBe(false);
    expect(res.headers.get('vary')).toContain('Origin');
  });
});

describe('CORS refused origins', () => {
  const refused = [
    'https://admin.mullnyphotos.cz.evil.com',
    'http://admin.mullnyphotos.cz',
    'https://admin.mullnyphotos.cz/',
    'https://ADMIN.mullnyphotos.cz',
    'https://admin.mullnyphotos.cz:443',
    'https://evil.com/https://admin.mullnyphotos.cz',
    'https://xadmin.mullnyphotos.cz',
    'https://mullnyphotos.cz',
    'null',
    '*',
    '',
    `${ADMIN}, ${LOCAL}`,
  ];

  it.each(refused)('refuses Origin %j with 403 on a normal request', async (origin) => {
    const before = handlerCalls;
    const res = await call('/guarded', { headers: { origin } });
    expect(res.status).toBe(403);
    expect(handlerCalls).toBe(before);
    expect(res.headers.has('access-control-allow-origin')).toBe(false);
    expect(res.headers.has('access-control-allow-credentials')).toBe(false);
    expect(res.headers.get('vary')).toContain('Origin');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ error: 'INVALID_REQUEST' });
  });

  it.each(refused)('refuses a preflight from Origin %j with 403 and no CORS headers', async (origin) => {
    const res = await call('/guarded', {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'POST' },
    });
    expect(res.status).toBe(403);
    expect(res.headers.has('access-control-allow-origin')).toBe(false);
    expect(res.headers.has('access-control-allow-methods')).toBe(false);
  });
});

describe('CORS preflight', () => {
  it('returns 204 with exact methods and headers, without auth and without reaching the route', async () => {
    const before = handlerCalls;
    const res = await call('/guarded', {
      method: 'OPTIONS',
      headers: {
        origin: ADMIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(handlerCalls).toBe(before);
    expect(res.headers.get('access-control-allow-origin')).toBe(ADMIN);
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
    expect(res.headers.get('access-control-allow-headers')).toBe('authorization, content-type');
    expect(res.headers.get('access-control-max-age')).toBe('600');
    expect(res.headers.get('vary')).toContain('Origin');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.has('access-control-allow-credentials')).toBe(false);
    expect(await res.text()).toBe('');
  });

  it('works for any path and for the second allowed origin', async () => {
    const res = await call('/anything', { method: 'OPTIONS', headers: { origin: LOCAL } });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(LOCAL);
  });

  it('OPTIONS without Origin gets 204 and no CORS headers', async () => {
    const res = await call('/guarded', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.has('access-control-allow-origin')).toBe(false);
    expect(res.headers.has('access-control-allow-methods')).toBe(false);
  });
});

describe('cors helpers', () => {
  it('checkOrigin and applyCors never use a wildcard or credentials', () => {
    const req = new Request('https://api.test/x', { headers: { origin: ADMIN } });
    const check = checkOrigin(req, [ADMIN]);
    expect(check).toEqual({ kind: 'allowed', origin: ADMIN });
    const res = applyCors(new Response(null), check);
    expect(res.headers.get('access-control-allow-origin')).toBe(ADMIN);
    expect(res.headers.has('access-control-allow-credentials')).toBe(false);
    expect(checkOrigin(req, [])).toEqual({ kind: 'denied' });
  });
});
