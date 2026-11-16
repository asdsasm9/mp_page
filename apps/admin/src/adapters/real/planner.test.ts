import { describe, expect, it } from 'vitest';
import { ApiError, CatalogError, NetworkError } from '../../ports';
import { createRest, type FetchFn } from './http';
import { createRealPlanner } from './planner';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}
type Reply = { status?: number; json?: unknown } | Error;

/** Records every call; answers from a queue (the last reply repeats). */
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

const BASE = 'https://project.example.test';
const planner = (fetch: FetchFn) =>
  createRealPlanner(createRest({ baseUrl: BASE, anonKey: 'anon-for-tests', getToken: async () => 'token-for-tests', fetch }));

const ID = 'dddddddd-0000-4000-8000-000000000001';
const P1 = 'dddddddd-0000-4000-8000-0000000000a1';
const P2 = 'dddddddd-0000-4000-8000-0000000000a2';
const AT = '2026-11-16T10:00:00.123456+00:00';

const row = (over: Record<string, unknown> = {}) => ({
  id: ID,
  caption: 'Ahoj',
  hashtags: '#a',
  planned_on: null,
  status: 'draft',
  posted_at: null,
  sort: 0,
  created_at: AT,
  updated_at: AT,
  ig_post_photos: [
    { photo_id: P2, sort: 2 },
    { photo_id: P1, sort: 1 },
  ],
  ...over,
});

const path = (url: string) => decodeURIComponent(url.slice(BASE.length));

describe('real planner', () => {
  it('lists posts with embedded photos under the user JWT only, parsed and ordered', async () => {
    const { fetch, calls } = stubFetch({
      json: [
        row({ id: 'dddddddd-0000-4000-8000-0000000000b1', status: 'posted', posted_at: AT, sort: 0 }),
        row({ sort: 10 }),
      ],
    });
    const posts = await planner(fetch).listPosts();
    expect(path(calls[0]!.url)).toBe('/rest/v1/ig_posts?select=*,ig_post_photos(photo_id,sort)&order=sort.asc,id.asc');
    expect(Object.keys(calls[0]!.headers).sort()).toEqual(['accept', 'apikey', 'authorization']);
    expect(calls[0]!.headers.authorization).toBe('Bearer token-for-tests');
    expect(posts.map((p) => p.status)).toEqual(['draft', 'posted']);
    expect(posts[0]!.photos).toEqual([
      { photo_id: P1, sort: 1 },
      { photo_id: P2, sort: 2 },
    ]);
    expect('ig_post_photos' in posts[0]!).toBe(false);
  });

  it('turns a body that does not match the schema into INTERNAL', async () => {
    const { fetch } = stubFetch({ json: [row({ status: 'weird' })] });
    await expect(planner(fetch).listPosts()).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('create: reads the lowest sort, inserts at lowest - 10, then calls the RPC and re-reads', async () => {
    const { fetch, calls } = stubFetch({ json: [{ sort: -20 }] }, { json: [{ id: ID }] }, { json: null }, { json: [row()] });
    const post = await planner(fetch).createPost({ caption: 'Ahoj', photoIds: [P1, P2], status: 'planned' });
    expect(calls.map((c) => `${c.method} ${path(c.url).split('?')[0]}`)).toEqual([
      'GET /rest/v1/ig_posts',
      'POST /rest/v1/ig_posts',
      'POST /rest/v1/rpc/ig_set_post_photos',
      'GET /rest/v1/ig_posts',
    ]);
    expect(path(calls[0]!.url)).toBe('/rest/v1/ig_posts?select=sort&order=sort.asc&limit=1');
    expect(calls[1]!.body).toEqual({ caption: 'Ahoj', hashtags: '', planned_on: null, status: 'planned', sort: -30 });
    expect(calls[2]!.body).toEqual({ p_post_id: ID, p_photo_ids: [P1, P2] });
    expect(post.id).toBe(ID);
  });

  it('create: the first post gets sort 0; a failing RPC deletes the new post again and rethrows', async () => {
    const { fetch, calls } = stubFetch(
      { json: [] },
      { json: [{ id: ID }] },
      { status: 400, json: { code: '23514', message: 'IG_PHOTOS_INVALID' } },
      { json: [] },
    );
    await expect(planner(fetch).createPost({ photoIds: [] })).rejects.toMatchObject({ code: 'INVALID' });
    expect(calls[1]!.body).toMatchObject({ sort: 0 });
    expect(calls[3]).toMatchObject({ method: 'DELETE' });
    expect(path(calls[3]!.url)).toBe(`/rest/v1/ig_posts?id=eq.${ID}`);
  });

  it('maps RPC errors: NOT_ADMIN, IG_POST_NOT_FOUND, IG_PHOTO_NOT_FOUND, IG_PHOTOS_INVALID', async () => {
    const rpc = (status: number, code: string, message: string) =>
      planner(stubFetch({ status, json: { code, message } }).fetch).setPostPhotos(ID, [P1]);
    await expect(rpc(403, '42501', 'NOT_ADMIN')).rejects.toMatchObject({ name: ApiError.name, code: 'NOT_ADMIN' });
    await expect(rpc(409, '23503', 'IG_POST_NOT_FOUND')).rejects.toMatchObject({ name: CatalogError.name, code: 'NOT_FOUND' });
    await expect(rpc(409, '23503', 'IG_PHOTO_NOT_FOUND')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(rpc(400, '23514', 'IG_PHOTOS_INVALID')).rejects.toMatchObject({ code: 'INVALID' });
    await expect(planner(stubFetch(new Error('offline')).fetch).setPostPhotos(ID, [P1])).rejects.toBeInstanceOf(NetworkError);
  });

  it('update: PATCH with the optimistic updated_at filter; STALE vs NOT_FOUND when nothing matches', async () => {
    const ok = stubFetch({ json: [row({ caption: 'Nový' })] });
    const post = await planner(ok.fetch).updatePost(ID, { caption: 'Nový' }, { expectedUpdatedAt: AT });
    expect(path(ok.calls[0]!.url)).toBe(`/rest/v1/ig_posts?id=eq.${ID}&select=*,ig_post_photos(photo_id,sort)&updated_at=eq.${AT}`);
    expect(ok.calls[0]!.body).toEqual({ caption: 'Nový' });
    expect(post.caption).toBe('Nový');

    const stale = stubFetch({ json: [] }, { json: [{ id: ID }] });
    await expect(planner(stale.fetch).updatePost(ID, { caption: 'x' }, { expectedUpdatedAt: AT })).rejects.toMatchObject({ code: 'STALE' });
    const gone = stubFetch({ json: [] }, { json: [] });
    await expect(planner(gone.fetch).updatePost(ID, { caption: 'x' }, { expectedUpdatedAt: AT })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses planned and posted without photos before sending a write', async () => {
    const none = stubFetch({ json: [] });
    await expect(planner(none.fetch).updatePost(ID, { status: 'planned' })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(planner(none.fetch).markPosted(ID, AT)).rejects.toMatchObject({ code: 'INVALID' });
    expect(none.calls.every((c) => c.method === 'GET')).toBe(true);
    // A caption edit does not need the check.
    const edit = stubFetch({ json: [row()] });
    await planner(edit.fetch).updatePost(ID, { caption: 'x' });
    expect(edit.calls).toHaveLength(1);
  });

  it('markPosted and unmarkPosted send the right bodies', async () => {
    const mark = stubFetch({ json: [{ photo_id: P1 }] }, { json: [row({ status: 'posted', posted_at: AT })] });
    await planner(mark.fetch).markPosted(ID, '2026-11-16T10:00:00.000Z');
    expect(mark.calls[1]!.body).toEqual({ status: 'posted', posted_at: '2026-11-16T10:00:00.000Z' });

    const unmark = stubFetch({ json: [row({ status: 'posted', posted_at: AT })] }, { json: [{ sort: 30 }] }, { json: [row({ sort: 40 })] });
    const back = await planner(unmark.fetch).unmarkPosted(ID);
    expect(path(unmark.calls[1]!.url)).toBe('/rest/v1/ig_posts?select=sort&order=sort.desc&limit=1&status=neq.posted');
    expect(unmark.calls[2]!.body).toEqual({ status: 'planned', posted_at: null, sort: 40 });
    expect(back.sort).toBe(40);

    const notPosted = stubFetch({ json: [row()] });
    await expect(planner(notPosted.fetch).unmarkPosted(ID)).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('reorder PATCHes one row each; delete removes only the post row', async () => {
    const re = stubFetch({ json: [{ id: ID }] });
    await planner(re.fetch).reorderPosts([{ id: ID, sort: 10 }, { id: P1, sort: 20 }]);
    expect(re.calls.map((c) => [c.method, c.body])).toEqual([['PATCH', { sort: 10 }], ['PATCH', { sort: 20 }]]);
    await expect(planner(stubFetch({ json: [] }).fetch).reorderPosts([{ id: ID, sort: 10 }])).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const del = stubFetch({ json: [] });
    await planner(del.fetch).deletePost(ID);
    expect(del.calls).toHaveLength(1);
    expect(del.calls[0]).toMatchObject({ method: 'DELETE' });
    expect(path(del.calls[0]!.url)).toBe(`/rest/v1/ig_posts?id=eq.${ID}`);
  });

  it('sends nothing without a session', async () => {
    const { fetch, calls } = stubFetch();
    const p = createRealPlanner(createRest({ baseUrl: BASE, anonKey: 'a', getToken: async () => null, fetch }));
    await expect(p.listPosts()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(calls).toHaveLength(0);
  });
});
