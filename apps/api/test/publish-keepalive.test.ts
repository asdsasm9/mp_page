import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublishResponseSchema, SNAPSHOT_KEY, createFakeStorage, variantPlan, type PhotoVariants } from '@mp/shared';
import { createPublishRoute } from '../src/routes/publish';
import { createScheduled, runKeepalive } from '../src/keepalive';
import { goodEnv } from '../src/test-support';
import { SHIM_ANON_KEY, makeWorld, type World } from './supabase-shim';

const CAT = 'aaaaaaaa-0000-4000-8000-000000000001';
const ALB = 'bbbbbbbb-0000-4000-8000-000000000001';
const PHOTO = 'cccccccc-0000-4000-8000-000000000001';
const HOOK_URL = goodEnv().PAGES_DEPLOY_HOOK_URL!;
const NOW = new Date('2026-10-19T12:00:00.000Z');

let world: World;
const publicBucket = createFakeStorage({ baseUrl: 'https://img.test' });
let hookFetch: ReturnType<typeof vi.fn<(input: Request | string | URL, init?: RequestInit) => Promise<Response>>>;

function variants(): PhotoVariants {
  const p = variantPlan(1200, 800);
  return {
    master: { w: p.master.w, h: p.master.h, bytes: 10 },
    webp: p.webp.map((e) => ({ tier: e.tier as 480, w: e.w, h: e.h, bytes: 10 })),
    jpeg: { w: p.jpeg.w, h: p.jpeg.h, bytes: 10 },
    og: { w: p.og.w, h: p.og.h, bytes: 10 },
  };
}

beforeAll(async () => {
  world = await makeWorld({
    deps: {
      routes: {
        '/publish': createPublishRoute({
          publicBucket,
          now: () => NOW,
          hookFetch: (input, init) => hookFetch(input, init),
        }),
      },
    },
  });
});
afterAll(() => world.close());

async function seed(published = true) {
  await world.db.exec(`
    delete from public.photos; delete from public.albums; delete from public.categories;
    delete from public.publish_log;
    insert into public.categories (id, slug, name, visible) values ('${CAT}', 'svatby', 'Svatby', true);
    insert into public.albums (id, category_id, slug, title, published) values ('${ALB}', '${CAT}', 'one', 'One', ${published});
    insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total) values
      ('${PHOTO}', '${ALB}', 'photos/${PHOTO}/master.jpg', 1200, 800, '${JSON.stringify(variants())}'::jsonb, 60);
    update public.site_state set pending_changes = 5, last_publish_requested_at = null, last_published_at = null;
  `);
}

beforeEach(async () => {
  hookFetch = vi.fn(async () => new Response(null, { status: 200 }));
  await publicBucket.delete(publicBucket.keys());
  await seed();
  world.shim.calls.length = 0;
});

const publish = async (token: string | null = world.tokens.admin) => {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await world.app.fetch(new Request('https://api.test/publish', { method: 'POST', headers }), world.env);
  return { status: res.status, text: await res.clone().text(), body: (await res.json()) as any };
};
const pending = async () =>
  Number((await world.db.query<{ n: number }>('select pending_changes as n from public.site_state')).rows[0]!.n);
const logRows = async () =>
  (await world.db.query<{ status: string; error: string | null }>('select status, error from public.publish_log')).rows;

describe('POST /publish', () => {
  it('success: one hook POST, record_publish ok, pending reduced by what was seen, log ok', async () => {
    const res = await publish();
    expect(res.status).toBe(200);
    expect(PublishResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.counts).toEqual({ categories: 1, albums: 1, photos: 1 });
    expect(res.body.pending_seen).toBe(5);
    expect(hookFetch).toHaveBeenCalledTimes(1);
    expect(hookFetch.mock.calls[0]![0]).toBe(HOOK_URL);
    expect(hookFetch.mock.calls[0]![1]?.method).toBe('POST');
    expect(await pending()).toBe(0);
    expect(await logRows()).toEqual([{ status: 'ok', error: null }]);
    expect(publicBucket.keys()).toEqual([SNAPSHOT_KEY]);
  });

  it('edits made between request and record stay pending', async () => {
    hookFetch.mockImplementation(async () => {
      await world.db.exec('update public.site_state set pending_changes = pending_changes + 2');
      return new Response(null, { status: 200 });
    });
    const res = await publish();
    expect(res.status).toBe(200);
    expect(await pending()).toBe(2);
  });

  it('a second call within 60 s is 429 PUBLISH_TOO_SOON with retryAfter and writes no snapshot', async () => {
    expect((await publish()).status).toBe(200);
    await publicBucket.delete(publicBucket.keys());
    const second = await publish();
    expect(second.status).toBe(429);
    expect(second.body.error).toBe('PUBLISH_TOO_SOON');
    expect(second.body.retryAfter).toBeGreaterThan(0);
    expect(second.body.retryAfter).toBeLessThanOrEqual(60);
    expect(publicBucket.keys()).toEqual([]);
    expect(hookFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['500 response', () => hookFetch.mockResolvedValue(new Response(null, { status: 500 }))],
    ['thrown error', () => hookFetch.mockRejectedValue(new Error(`boom ${HOOK_URL}`))],
  ])('hook failure (%s): log failed, pending unchanged, 502 PUBLISH_FAILED without the hook URL', async (_n, arrange) => {
    arrange();
    const res = await publish();
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'PUBLISH_FAILED' });
    expect(res.text).not.toContain('hook-secret');
    expect(await pending()).toBe(5);
    const rows = await logRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.error).not.toContain('hook-secret');
  });

  it('SNAPSHOT_EMPTY is 409, no hook call, log failed, nothing written', async () => {
    await seed(false);
    const res = await publish();
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'SNAPSHOT_EMPTY' });
    expect(hookFetch).not.toHaveBeenCalled();
    expect((await logRows())[0]!.status).toBe('failed');
    expect(await pending()).toBe(5);
    expect(publicBucket.keys()).toEqual([]);
  });

  it('a storage write failure is UPSTREAM_ERROR and does not call the hook', async () => {
    const put = publicBucket.put.bind(publicBucket);
    publicBucket.put = async () => Promise.reject(new Error('r2 down'));
    try {
      const res = await publish();
      expect(res.status).toBe(502);
      expect(res.body.error).toBe('UPSTREAM_ERROR');
      expect(hookFetch).not.toHaveBeenCalled();
      expect((await logRows())[0]!.status).toBe('failed');
    } finally {
      publicBucket.put = put;
    }
  });

  it('a non-admin is refused with no catalog read and no hook call', async () => {
    const res = await publish(world.tokens.nonAdmin);
    expect(res.status).toBe(403);
    expect(world.shim.calls.some((c) => c.path.includes('/rest/v1/categories') || c.path.includes('/rest/v1/photos'))).toBe(false);
    expect(hookFetch).not.toHaveBeenCalled();
    expect(await logRows()).toEqual([]);
  });

  it('unauthenticated is 401', async () => {
    expect((await publish(null)).status).toBe(401);
    expect(hookFetch).not.toHaveBeenCalled();
  });
});

describe('keepalive', () => {
  const keepaliveRow = async () =>
    (await world.db.query<{ pings: number }>('select pings from public.keepalive')).rows[0]!.pings;

  it('calls the RPC with the anon key and no user token; two calls within a minute change the row once', async () => {
    const before = Number(await keepaliveRow());
    world.shim.calls.length = 0;
    const seen: Headers[] = [];
    const fetchSpy = (input: Request | string | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return world.shim.fetch(input, init);
    };
    expect(await runKeepalive(world.env, { fetch: fetchSpy, env: { allowInsecureUrls: true } })).toBe(true);
    expect(await runKeepalive(world.env, { fetch: fetchSpy, env: { allowInsecureUrls: true } })).toBe(true);
    expect(world.shim.calls.map((c) => [c.method, c.path, c.role])).toEqual([
      ['POST', '/rest/v1/rpc/keepalive', 'anon'],
      ['POST', '/rest/v1/rpc/keepalive', 'anon'],
    ]);
    for (const h of seen) {
      expect(h.get('apikey')).toBe(SHIM_ANON_KEY);
      expect(h.get('authorization')).toBe(`Bearer ${SHIM_ANON_KEY}`);
    }
    expect(Number(await keepaliveRow())).toBe(before + 1);
  });

  it('the scheduled handler runs the ping', async () => {
    const spy = vi.fn(world.shim.fetch);
    await createScheduled({ fetch: spy })({}, world.env);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('an upstream failure or network error is logged and does not throw', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await runKeepalive(world.env, { fetch: async () => new Response('x', { status: 500 }) })).toBe(false);
      expect(await runKeepalive(world.env, { fetch: async () => Promise.reject(new Error(`secret ${SHIM_ANON_KEY}`)) })).toBe(false);
      await expect(createScheduled({ fetch: async () => Promise.reject(new Error('x')) })({}, world.env)).resolves.toBeUndefined();
      expect(err).toHaveBeenCalled();
      expect(err.mock.calls.flat().join(' ')).not.toContain(SHIM_ANON_KEY);
    } finally {
      err.mockRestore();
    }
  });

  it('a bad config is logged without values and returns false', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await runKeepalive({ SUPABASE_URL: 'nope' })).toBe(false);
      expect(err.mock.calls.flat().join(' ')).not.toContain('nope');
    } finally {
      err.mockRestore();
    }
  });
});
