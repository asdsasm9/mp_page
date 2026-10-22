import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createSupabaseClient, mapSupabaseError } from './supabase';

const URL_BASE = 'https://abcdefgh.supabase.co';
const ANON = 'anon-test-key-value';
const JWT = 'aaaaaaaa.bbbbbbbb.cccc';

interface Seen {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

function stub(responder: (seen: Seen, n: number) => Response | Promise<Response>) {
  const calls: Seen[] = [];
  const fetchFn = vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
    const seen: Seen = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
    };
    calls.push(seen);
    return responder(seen, calls.length);
  });
  const client = createSupabaseClient({ supabaseUrl: URL_BASE, anonKey: ANON, fetch: fetchFn, timeoutMs: 200 });
  return { client, calls, fetchFn };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('headers', () => {
  it('rpc sends apikey (anon) and the caller JWT, nothing else', async () => {
    const { client, calls } = stub(() => json({ ok: 1 }));
    const r = await client.rpc('storage_usage', { a: 1 }, JWT);
    expect(r).toEqual({ ok: true, data: { ok: 1 } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${URL_BASE}/rest/v1/rpc/storage_usage`);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers.get('apikey')).toBe(ANON);
    expect(calls[0]!.headers.get('authorization')).toBe(`Bearer ${JWT}`);
    expect(calls[0]!.body).toBe('{"a":1}');
  });

  it('select sends both headers on every page', async () => {
    const { client, calls } = stub(() => json([{ id: 1 }]));
    await client.select('photos', { select: 'id' }, JWT);
    for (const c of calls) {
      expect(c.headers.get('apikey')).toBe(ANON);
      expect(c.headers.get('authorization')).toBe(`Bearer ${JWT}`);
    }
  });

  it('refuses an empty JWT without calling upstream', async () => {
    const { client, fetchFn } = stub(() => json([]));
    const r = await client.rpc('is_admin', {}, '');
    expect(r).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects odd function and table names', async () => {
    const { client, fetchFn } = stub(() => json([]));
    expect(await client.rpc('a/../b', {}, JWT)).toMatchObject({ ok: false });
    expect(await client.select('photos?x=1', undefined, JWT)).toMatchObject({ ok: false });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('error mapping', () => {
  it('maps a PostgREST message to our code', async () => {
    const { client } = stub(() => json({ code: 'P0001', message: 'STORAGE_FULL', details: null }, 400));
    expect(await client.rpc('reserve_uploads', {}, JWT)).toEqual({ ok: false, code: 'STORAGE_FULL', status: 400 });
  });

  it('maps an unknown error to UPSTREAM_ERROR without echoing the body', async () => {
    const { client } = stub(() => json({ message: 'relation "secret_table" does not exist', hint: 'leak' }, 500));
    const r = await client.rpc('x', {}, JWT);
    expect(r).toEqual({ ok: false, code: 'UPSTREAM_ERROR', status: 500 });
    expect(JSON.stringify(r)).not.toContain('secret_table');
  });

  it('maps 401 to UNAUTHENTICATED', async () => {
    const { client } = stub(() => json({ message: 'JWT expired' }, 401));
    expect(await client.rpc('x', {}, JWT)).toEqual({ ok: false, code: 'UNAUTHENTICATED', status: 401 });
  });

  it('maps SQLSTATE 42501 to NOT_ADMIN', () => {
    expect(mapSupabaseError(403, { code: '42501', message: 'permission denied' })).toBe('NOT_ADMIN');
  });

  it('a non-JSON error body and a non-JSON success body are UPSTREAM_ERROR', async () => {
    const a = stub(() => new Response('<html>oops</html>', { status: 502 }));
    expect(await a.client.rpc('x', {}, JWT)).toMatchObject({ ok: false, code: 'UPSTREAM_ERROR' });
    const b = stub(() => new Response('<html>oops</html>', { status: 200 }));
    expect(await b.client.rpc('x', {}, JWT)).toMatchObject({ ok: false, code: 'UPSTREAM_ERROR' });
  });

  it('a network error and a timeout are UPSTREAM_ERROR with status 0', async () => {
    const a = stub(() => {
      throw new TypeError('connect ECONNREFUSED https://abcdefgh.supabase.co');
    });
    expect(await a.client.rpc('x', {}, JWT)).toEqual({ ok: false, code: 'UPSTREAM_ERROR', status: 0 });
    const b = createSupabaseClient({
      supabaseUrl: URL_BASE,
      anonKey: ANON,
      timeoutMs: 20,
      fetch: (_i, init) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener('abort', () => rej(new Error('aborted')));
        }),
    });
    expect(await b.rpc('x', {}, JWT)).toEqual({ ok: false, code: 'UPSTREAM_ERROR', status: 0 });
  });

  it('204 from an RPC gives null data', async () => {
    const { client } = stub(() => new Response(null, { status: 204 }));
    expect(await client.rpc('x', {}, JWT)).toEqual({ ok: true, data: null });
  });
});

describe('paging', () => {
  it('walks pages until a short page', async () => {
    const pages = [[1, 2, 3], [4, 5, 6], [7]];
    const { client, calls } = stub((_s, n) => json(pages[n - 1]));
    const r = await client.select<number>('photos', { select: 'id', order: 'id' }, JWT, { pageSize: 3 });
    expect(r).toEqual({ ok: true, data: [1, 2, 3, 4, 5, 6, 7] });
    expect(calls.map((c) => c.headers.get('range'))).toEqual(['0-2', '3-5', '6-8']);
    expect(calls[0]!.headers.get('range-unit')).toBe('items');
    expect(calls[0]!.url).toBe(`${URL_BASE}/rest/v1/photos?select=id&order=id`);
  });

  it('an exactly full last page costs one extra empty page', async () => {
    const pages = [[1, 2], []];
    const { client, calls } = stub((_s, n) => json(pages[n - 1]));
    const r = await client.select<number>('photos', undefined, JWT, { pageSize: 2 });
    expect(r).toEqual({ ok: true, data: [1, 2] });
    expect(calls).toHaveLength(2);
  });

  it('an error on a later page fails the whole select', async () => {
    const { client } = stub((_s, n) => (n === 1 ? json([1, 2]) : json({ message: 'boom' }, 500)));
    expect(await client.select('photos', undefined, JWT, { pageSize: 2 })).toMatchObject({
      ok: false,
      code: 'UPSTREAM_ERROR',
    });
  });

  it('fails instead of truncating when maxPages is hit', async () => {
    const { client } = stub(() => json([1, 2]));
    expect(await client.select('photos', undefined, JWT, { pageSize: 2, maxPages: 3 })).toMatchObject({
      ok: false,
      code: 'UPSTREAM_ERROR',
    });
  });

  it('a non-array body is UPSTREAM_ERROR', async () => {
    const { client } = stub(() => json({ a: 1 }));
    expect(await client.select('photos', undefined, JWT)).toMatchObject({ ok: false, code: 'UPSTREAM_ERROR' });
  });
});

describe('no privileged key', () => {
  it('worker sources never mention the privileged database role', () => {
    const marker = ['service', 'role'].join('_');
    for (const f of ['supabase.ts', 'auth.ts', 'env.ts', 'index.ts', 'http.ts', 'cors.ts']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
      expect(src.toLowerCase(), f).not.toContain(marker);
    }
  });
});
