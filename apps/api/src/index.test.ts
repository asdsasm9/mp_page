import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_STATUS, WORKER_ERROR_CODES, ErrorBodySchema } from '@mp/shared';
import { createApp, type Route } from './index';
import { jsonResponse, readJsonBody } from './http';
import { parseEnv } from './env';
import { ADMIN, goodEnv } from './test-support';

const echoRoute: Route = {
  methods: ['POST'],
  auth: false,
  handler: async ({ request }) => {
    const body = await readJsonBody(request, { maxBytes: 64 });
    if (!body.ok) return jsonResponse({ error: body.code }, body.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400);
    return jsonResponse({ got: body.value }, 200);
  },
};

const boomRoute: Route = {
  methods: ['GET'],
  auth: false,
  handler: () => {
    throw new Error('secret-token-xyz at https://leak.example');
  },
};

const app = createApp({ routes: { '/echo': echoRoute, '/boom': boomRoute } });
const call = (path: string, init?: RequestInit, env: Record<string, unknown> | undefined = goodEnv()) =>
  app.fetch(new Request(`https://api.test${path}`, init), env);

const post = (body: BodyInit | null, headers: Record<string, string> = { 'content-type': 'application/json' }) => ({
  method: 'POST',
  headers,
  body,
});

function expectBaseHeaders(res: Response) {
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('vary')?.toLowerCase()).toContain('origin');
}

describe('health, routing', () => {
  it('GET /health returns {ok:true} with base headers', async () => {
    const res = await call('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expectBaseHeaders(res);
  });

  it('unknown path returns 404 NOT_FOUND', async () => {
    const res = await call('/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'NOT_FOUND' });
    expectBaseHeaders(res);
  });

  it('prototype keys are not routes', async () => {
    expect((await call('/constructor')).status).toBe(404);
    expect((await call('/__proto__')).status).toBe(404);
  });

  it('wrong method returns 405 with Allow', async () => {
    const res = await call('/health', { method: 'POST' });
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: 'METHOD_NOT_ALLOWED' });
    expect(res.headers.get('allow')).toBe('GET, OPTIONS');
    expectBaseHeaders(res);
  });

  it('a throwing handler gives 500 INTERNAL without leaking', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await call('/boom');
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: 'INTERNAL' });
    expect(text).not.toContain('secret-token-xyz');
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret-token-xyz');
    expectBaseHeaders(res);
    spy.mockRestore();
  });

  it('every error code has a status and a valid body', async () => {
    for (const code of WORKER_ERROR_CODES) expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
    expect(ErrorBodySchema.safeParse({ error: 'NOT_FOUND' }).success).toBe(true);
  });
});

describe('env validation', () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => spy.mockRestore());

  const broken: Array<[string, (e: Record<string, string>) => Record<string, unknown>]> = [
    ['missing SUPABASE_URL', (e) => ({ ...e, SUPABASE_URL: undefined as unknown as string })],
    ['http SUPABASE_URL', (e) => ({ ...e, SUPABASE_URL: 'http://abc.supabase.co' })],
    ['garbage SUPABASE_URL', (e) => ({ ...e, SUPABASE_URL: 'not a url' })],
    ['empty anon key', (e) => ({ ...e, SUPABASE_ANON_KEY: '  ' })],
    ['short account id', (e) => ({ ...e, R2_ACCOUNT_ID: 'abc' })],
    ['bad bucket', (e) => ({ ...e, R2_BUCKET: 'Bad Bucket!' })],
    ['http public base', (e) => ({ ...e, R2_PUBLIC_BASE_URL: 'http://img.example' })],
    ['http deploy hook', (e) => ({ ...e, PAGES_DEPLOY_HOOK_URL: 'http://hook.example/x' })],
    ['wildcard origin', (e) => ({ ...e, ALLOWED_ORIGINS: '*' })],
    ['null origin', (e) => ({ ...e, ALLOWED_ORIGINS: 'null' })],
    ['origin with path', (e) => ({ ...e, ALLOWED_ORIGINS: `${ADMIN}/` })],
    ['origin with empty entry', (e) => ({ ...e, ALLOWED_ORIGINS: `${ADMIN},` })],
    ['non-string binding', (e) => ({ ...e, R2_SECRET_ACCESS_KEY: { fake: true } })],
  ];

  it.each(broken)('%s gives 500 CONFIG_ERROR with no values', async (_name, mutate) => {
    const env = mutate(goodEnv());
    const res = await call('/health', undefined, env);
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: 'CONFIG_ERROR' });
    for (const v of Object.values(env)) if (typeof v === 'string' && v.length > 6) expect(text).not.toContain(v);
    const logged = JSON.stringify(spy.mock.calls);
    for (const v of Object.values(goodEnv())) expect(logged).not.toContain(v);
    expectBaseHeaders(res);
  });

  it('undefined env gives CONFIG_ERROR and the log lists names only', async () => {
    const res = await call('/health', undefined, null as unknown as undefined);
    expect(res.status).toBe(500);
    expect(String(spy.mock.calls[0]?.[0])).toContain('SUPABASE_URL');
  });

  it('parseEnv accepts the good env and an http URL only with the test flag', () => {
    expect(parseEnv(goodEnv()).ok).toBe(true);
    const local = { ...goodEnv(), SUPABASE_URL: 'http://127.0.0.1:54321' };
    expect(parseEnv(local).ok).toBe(false);
    expect(parseEnv(local, { allowInsecureUrls: true }).ok).toBe(true);
  });
});

describe('body limits', () => {
  it('accepts a small JSON body', async () => {
    const res = await call('/echo', post('{"a":1}'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ got: { a: 1 } });
    expectBaseHeaders(res);
  });

  it('accepts a charset parameter and mixed case content type', async () => {
    const res = await call('/echo', post('{}', { 'content-type': 'Application/JSON; charset=utf-8' }));
    expect(res.status).toBe(200);
  });

  it.each(['text/plain', 'application/x-www-form-urlencoded', 'application/jsonx', ''])(
    'content type %j gives 400 INVALID_REQUEST',
    async (ct) => {
      const headers: Record<string, string> = ct ? { 'content-type': ct } : {};
      const res = await call('/echo', { method: 'POST', headers, body: new Uint8Array([123, 125]) });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'INVALID_REQUEST' });
    },
  );

  it('missing content type gives 400', async () => {
    const res = await call('/echo', { method: 'POST', body: new Uint8Array([123, 125]) });
    expect(res.status).toBe(400);
  });

  it('invalid JSON and empty body give 400', async () => {
    expect((await call('/echo', post('{nope'))).status).toBe(400);
    expect((await call('/echo', post(''))).status).toBe(400);
    expect((await call('/echo', { method: 'POST' })).status).toBe(400);
  });

  it('declared oversized body gives 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await call('/echo', post('x', { 'content-type': 'application/json', 'content-length': '65' }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'PAYLOAD_TOO_LARGE' });
  });

  it('malformed Content-Length gives 400', () => {
    const req = new Request('https://api.test/x', post('{}', { 'content-type': 'application/json', 'content-length': '1e3' }));
    return expect(readJsonBody(req)).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
  });

  it('streamed oversized body without Content-Length gives 413 and stops reading', async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(32).fill(97));
        if (pulls > 1000) controller.close();
      },
    });
    const req = new Request('https://api.test/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    const res = await app.fetch(req, goodEnv());
    expect(res.status).toBe(413);
    expect(pulls).toBeLessThan(10);
  });

  it('body exactly at the limit passes', async () => {
    const body = JSON.stringify({ s: 'a'.repeat(64 - 8) });
    expect(new TextEncoder().encode(body).length).toBe(64);
    expect((await call('/echo', post(body))).status).toBe(200);
  });

  it('default limit is 256 KB', async () => {
    const ok = await readJsonBody(
      new Request('https://api.test/x', post(JSON.stringify({ s: 'a'.repeat(200 * 1024) }))),
    );
    expect(ok.ok).toBe(true);
    const big = await readJsonBody(
      new Request('https://api.test/x', post(JSON.stringify({ s: 'a'.repeat(300 * 1024) }))),
    );
    expect(big).toEqual({ ok: false, code: 'PAYLOAD_TOO_LARGE' });
  });

  it('allowEmpty accepts a missing body', async () => {
    const r = await readJsonBody(new Request('https://api.test/x', { method: 'POST' }), { allowEmpty: true });
    expect(r).toEqual({ ok: true, value: {} });
  });
});
