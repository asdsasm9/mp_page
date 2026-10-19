import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFakeStorage } from '@mp/shared';
import worker, { createApp, type Route } from '../src/index';
import { DEFAULT_ROUTES } from '../src/default-routes';
import { createFakeBucket } from '../src/storage/fake-bucket';
import { missingBindings, storagesFromEnv } from '../src/storage/bindings';
import { parseEnv } from '../src/env';
import { goodEnv } from '../src/test-support';
import { makeWorld, type World } from './supabase-shim';

let world: World;
const fakeStorages = () => ({
  photos: createFakeStorage({ baseUrl: 'https://img.test' }),
  backup: createFakeStorage({ baseUrl: 'https://backup.invalid' }),
});

beforeAll(async () => {
  world = await makeWorld({ deps: { storage: () => fakeStorages() } });
});
afterAll(() => world.close());

const TABLE: Array<[method: string, path: string]> = [
  ['GET', '/storage'],
  ['POST', '/uploads/reserve'],
  ['POST', '/uploads/commit'],
  ['POST', '/photos/delete'],
  ['POST', '/storage/reconcile'],
  ['POST', '/publish'],
];

const send = (method: string, path: string, token: string | null, env: Record<string, unknown> = world.env) => {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return world.app.fetch(new Request(`https://api.test${path}`, { method, headers }), env);
};

describe('router: every route requires auth', () => {
  it('the default table is exactly the documented route set', () => {
    expect(Object.keys(DEFAULT_ROUTES).sort()).toEqual(TABLE.map(([, p]) => p).sort());
  });

  it.each(TABLE)('%s %s: no token 401, expired 401, non-admin 403', async (method, path) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect((await send(method, path, null)).status).toBe(401);
      expect((await send(method, path, world.tokens.expired)).status).toBe(401);
      expect((await send(method, path, world.tokens.nonAdmin)).status).toBe(403);
    } finally {
      warn.mockRestore();
    }
  });

  it.each(TABLE)('%s %s: an admin gets past auth and routing', async (method, path) => {
    const res = await send(method, path, world.tokens.admin);
    expect([401, 403, 404, 405, 500]).not.toContain(res.status);
  });

  it.each(TABLE)('%s %s: the wrong method is 405 with Allow', async (method, path) => {
    const other = method === 'GET' ? 'POST' : 'GET';
    const res = await send(other, path, world.tokens.admin);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe(`${method}, OPTIONS`);
  });

  it('GET /health needs no auth and POST /health is 405', async () => {
    expect((await send('GET', '/health', null)).status).toBe(200);
    expect((await send('POST', '/health', null)).status).toBe(405);
  });
});

describe('router: R2 bindings', () => {
  const buckets = () => ({ PHOTOS: createFakeBucket(), BACKUP: createFakeBucket() });

  it('missingBindings names what is absent or not bucket-shaped', () => {
    expect(missingBindings({})).toEqual(['PHOTOS', 'BACKUP']);
    expect(missingBindings({ PHOTOS: createFakeBucket(), BACKUP: 'x' })).toEqual(['BACKUP']);
    expect(missingBindings({ ...buckets() })).toEqual([]);
  });

  it('storagesFromEnv gives a presigning photos adapter and a private backup adapter', async () => {
    const parsed = parseEnv(goodEnv());
    if (!parsed.ok) throw new Error('env');
    const s = storagesFromEnv({ ...buckets() }, parsed.config)!;
    expect(s.photos.publicUrl('catalog/published.json')).toBe('https://img.mullnyphotos.cz/catalog/published.json');
    expect(() => s.backup.publicUrl('catalog/published.json')).toThrow();
    expect(storagesFromEnv({}, parsed.config)).toBeNull();
  });

  it('the default app serves /storage from real adapters built on the bindings', async () => {
    const app = createApp({ fetch: world.shim.fetch });
    const res = await app.fetch(
      new Request('https://api.test/storage', { headers: { authorization: `Bearer ${world.tokens.admin}` } }),
      { ...world.env, ...buckets() },
    );
    expect(res.status).toBe(200);
  });

  it('missing bindings give 500 CONFIG_ERROR naming the bindings, and /health still works', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const app = createApp({ fetch: world.shim.fetch });
      const res = await app.fetch(
        new Request('https://api.test/storage', { headers: { authorization: `Bearer ${world.tokens.admin}` } }),
        world.env,
      );
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'CONFIG_ERROR' });
      expect(err.mock.calls.flat().join(' ')).toContain('PHOTOS');
      expect((await app.fetch(new Request('https://api.test/health'), world.env)).status).toBe(200);
    } finally {
      err.mockRestore();
    }
  });
});

describe('router: request id and redacting logger', () => {
  const boom: Route = {
    methods: ['POST'],
    auth: false,
    handler: async ({ request }) => {
      const body = await request.text();
      throw new TypeError(`secret-input ${body} https://leak.example`);
    },
  };
  const app = createApp({ routes: { '/boom': boom } });

  it('every response carries a fresh x-request-id; a client-supplied one is ignored', async () => {
    const a = await app.fetch(new Request('https://api.test/health', { headers: { 'x-request-id': 'attacker-id' } }), goodEnv());
    const b = await app.fetch(new Request('https://api.test/health'), goodEnv());
    const ida = a.headers.get('x-request-id')!;
    expect(ida).toMatch(/^[0-9a-f-]{36}$/);
    expect(b.headers.get('x-request-id')).not.toBe(ida);
    const nf = await app.fetch(new Request('https://api.test/nope'), goodEnv());
    expect(nf.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('an unexpected exception is 500 {error:INTERNAL}; the log has request id and error name, not the message', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const res = await app.fetch(new Request('https://api.test/boom', { method: 'POST', body: 'user-typed-text' }), goodEnv());
      const text = await res.text();
      expect(res.status).toBe(500);
      expect(JSON.parse(text)).toEqual({ error: 'INTERNAL' });
      const id = res.headers.get('x-request-id')!;
      const logged = [...err.mock.calls, ...info.mock.calls].flat().join(' ');
      expect(logged).toContain(id);
      expect(logged).toContain('TypeError');
      for (const leak of ['secret-input', 'user-typed-text', 'leak.example']) {
        expect(logged).not.toContain(leak);
        expect(text).not.toContain(leak);
      }
    } finally {
      err.mockRestore();
      info.mockRestore();
    }
  });

  it('the access log holds method, path and status but never the query or the authorization header', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      await app.fetch(
        new Request('https://api.test/health?token=query-secret', { headers: { authorization: 'Bearer header-secret' } }),
        goodEnv(),
      );
      const logged = info.mock.calls.flat().join(' ');
      expect(logged).toContain('/health');
      expect(logged).toContain('200');
      expect(logged).not.toContain('query-secret');
      expect(logged).not.toContain('header-secret');
    } finally {
      info.mockRestore();
    }
  });
});

describe('worker entry, cron and wrangler.toml', () => {
  const toml = readFileSync(fileURLToPath(new URL('../wrangler.toml', import.meta.url).href), 'utf8');

  it('exports fetch and scheduled', () => {
    expect(typeof worker.fetch).toBe('function');
    expect(typeof worker.scheduled).toBe('function');
  });

  it('has exactly one cron expression and it parses as daily at an off-peak, non-round minute', () => {
    const m = /^\s*crons\s*=\s*\[([^\]]*)\]/m.exec(toml);
    expect(m).not.toBeNull();
    const exprs = [...m![1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
    expect(exprs).toHaveLength(1);
    const [min, hour, dom, mon, dow, ...rest] = exprs[0]!.split(/\s+/);
    expect(rest).toEqual([]);
    expect([dom, mon, dow]).toEqual(['*', '*', '*']);
    expect(min).toMatch(/^\d+$/);
    expect(hour).toMatch(/^\d+$/);
    expect(Number(min)).toBeLessThan(60);
    expect(Number(hour)).toBeLessThan(24);
    expect(Number(min) % 5).not.toBe(0);
    expect(Number(hour)).toBeLessThan(6);
  });

  it('holds no secret or token values', () => {
    const lines = toml.split('\n').filter((l) => !l.trim().startsWith('#'));
    const joined = lines.join('\n');
    expect(joined).not.toMatch(/\[vars\]/);
    expect(joined).not.toMatch(/(secret|token|password|api[_-]?key|hook|service.role)\s*=/i);
    expect(joined).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(joined).not.toMatch(/\b[0-9a-f]{32,}\b/i);
    expect(joined).not.toMatch(/https?:\/\//);
  });
});
