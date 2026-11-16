import { describe, expect, it } from 'vitest';
import { effectiveStatus } from '@mp/shared';
import { ApiError, CatalogError, NetworkError } from '../../ports';
import { createFakeWorld, fixtureSnapshot } from './index';

function setup(options: { plannerSeed?: boolean; signedIn?: boolean } = {}) {
  const world = createFakeWorld({ signedIn: options.signedIn ?? true, seed: fixtureSnapshot(), plannerSeed: options.plannerSeed ?? false });
  const photoIds = (world.snapshot().photos as { id: string }[]).map((p) => p.id);
  return { world, planner: world.ports.planner, photoIds };
}

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof CatalogError || error instanceof ApiError ? error.code : (error as Error).name;
  }
  return 'OK';
};

describe('fake planner', () => {
  it('starts empty and creates posts on top with their photos in order', async () => {
    const { planner, photoIds } = setup();
    expect(await planner.listPosts()).toEqual([]);
    const a = await planner.createPost({ caption: 'A', photoIds: [photoIds[2]!, photoIds[0]!] });
    const b = await planner.createPost({ caption: 'B', photoIds: [photoIds[1]!], status: 'planned' });
    expect(a.sort).toBe(0);
    expect(b.sort).toBe(-10);
    expect(a.photos).toEqual([
      { photo_id: photoIds[2], sort: 1 },
      { photo_id: photoIds[0], sort: 2 },
    ]);
    expect((await planner.listPosts()).map((p) => p.caption)).toEqual(['B', 'A']);
  });

  it('enforces the table checks: lengths in code points, date, and 1..10 distinct existing photos', async () => {
    const { planner, photoIds } = setup();
    const ok = { photoIds: [photoIds[0]!] };
    expect(await code(planner.createPost({ ...ok, caption: '😀'.repeat(2200) }))).toBe('OK');
    expect(await code(planner.createPost({ ...ok, caption: 'a'.repeat(2201) }))).toBe('INVALID');
    expect(await code(planner.createPost({ ...ok, hashtags: 'a'.repeat(2201) }))).toBe('INVALID');
    expect(await code(planner.createPost({ ...ok, planned_on: '16.11.2026' }))).toBe('INVALID');
    expect(await code(planner.createPost({ photoIds: [] }))).toBe('INVALID');
    expect(await code(planner.createPost({ photoIds: [photoIds[0]!, photoIds[0]!] }))).toBe('INVALID');
    expect(await code(planner.createPost({ photoIds: Array.from({ length: 11 }, (_, i) => photoIds[i % photoIds.length]!) }))).toBe('INVALID');
    expect(await code(planner.createPost({ photoIds: ['dddddddd-0000-4000-8000-00000000ffff'] }))).toBe('NOT_FOUND');
  });

  it('a failed create leaves no post behind', async () => {
    const { planner, photoIds } = setup();
    await code(planner.createPost({ photoIds: [photoIds[0]!, 'dddddddd-0000-4000-8000-00000000ffff'] }));
    expect(await planner.listPosts()).toEqual([]);
  });

  it('setPostPhotos replaces the set atomically with positions 1..n and refuses bad lists', async () => {
    const { planner, photoIds } = setup();
    const post = await planner.createPost({ photoIds: [photoIds[0]!, photoIds[1]!] });
    await planner.setPostPhotos(post.id, [photoIds[3]!, photoIds[1]!, photoIds[0]!]);
    let [now] = await planner.listPosts();
    expect(now!.photos.map((p) => [p.photo_id, p.sort])).toEqual([[photoIds[3], 1], [photoIds[1], 2], [photoIds[0], 3]]);
    expect(await code(planner.setPostPhotos(post.id, []))).toBe('INVALID');
    expect(await code(planner.setPostPhotos(post.id, [photoIds[0]!, 'dddddddd-0000-4000-8000-00000000ffff']))).toBe('NOT_FOUND');
    expect(await code(planner.setPostPhotos('dddddddd-0000-4000-8000-00000000fffe', [photoIds[0]!]))).toBe('NOT_FOUND');
    [now] = await planner.listPosts();
    expect(now!.photos).toHaveLength(3);
  });

  it('refuses planned and posted without photos, but allows other edits of such a post', async () => {
    const { world, planner, photoIds } = setup();
    const post = await planner.createPost({ photoIds: [photoIds[0]!] });
    await world.ports.api.deletePhotos({ ids: [photoIds[0]!] });
    const [broken] = await planner.listPosts();
    expect(broken!.photos).toEqual([]);
    expect(await code(planner.updatePost(post.id, { status: 'planned' }))).toBe('INVALID');
    expect(await code(planner.markPosted(post.id, '2026-11-16T10:00:00.000Z'))).toBe('INVALID');
    const edited = await planner.updatePost(post.id, { caption: 'Nový' });
    expect(edited.caption).toBe('Nový');
    expect(effectiveStatus({ status: 'planned', photos: edited.photos })).toBe('draft');
  });

  it('deleting a photo cascades out of every post and the rest keep their sort; deleting a post keeps the photo', async () => {
    const { world, planner, photoIds } = setup();
    const a = await planner.createPost({ photoIds: [photoIds[0]!, photoIds[1]!, photoIds[2]!] });
    const b = await planner.createPost({ photoIds: [photoIds[1]!] });
    await world.ports.api.deletePhotos({ ids: [photoIds[1]!] });
    const posts = await planner.listPosts();
    expect(posts.find((p) => p.id === a.id)!.photos).toEqual([
      { photo_id: photoIds[0], sort: 1 },
      { photo_id: photoIds[2], sort: 3 },
    ]);
    expect(posts.find((p) => p.id === b.id)!.photos).toEqual([]);
    await planner.deletePost(a.id);
    expect((await planner.listPosts()).map((p) => p.id)).toEqual([b.id]);
    expect((world.snapshot().photos as { id: string }[]).some((p) => p.id === photoIds[0])).toBe(true);
    await planner.deletePost(a.id);
  });

  it('marks posted, orders posted by date after the open posts, and unmarks to the end of the open block', async () => {
    const { planner, photoIds } = setup();
    const a = await planner.createPost({ caption: 'A', photoIds: [photoIds[0]!], status: 'planned' });
    const b = await planner.createPost({ caption: 'B', photoIds: [photoIds[1]!], status: 'planned' });
    const c = await planner.createPost({ caption: 'C', photoIds: [photoIds[2]!], status: 'planned' });
    const posted = await planner.markPosted(a.id, '2026-11-01T11:00:00.000Z');
    expect(posted).toMatchObject({ status: 'posted', posted_at: '2026-11-01T11:00:00.000Z', sort: 0 });
    await planner.markPosted(b.id, '2026-11-10T11:00:00.000Z');
    expect((await planner.listPosts()).map((p) => p.caption)).toEqual(['C', 'B', 'A']);
    const back = await planner.unmarkPosted(b.id);
    expect(back).toMatchObject({ status: 'planned', posted_at: null });
    expect(back.sort).toBe(c.sort + 10);
    expect((await planner.listPosts()).map((p) => p.caption)).toEqual(['C', 'B', 'A']);
    expect(await code(planner.unmarkPosted(c.id))).toBe('INVALID');
    expect(await code(planner.updatePost(a.id, { status: 'draft' }))).toBe('INVALID');
  });

  it('reorders by saving the given sorts and refuses an unknown post without changing anything', async () => {
    const { planner, photoIds } = setup();
    const a = await planner.createPost({ caption: 'A', photoIds: [photoIds[0]!] });
    const b = await planner.createPost({ caption: 'B', photoIds: [photoIds[1]!] });
    await planner.reorderPosts([{ id: a.id, sort: -20 }, { id: b.id, sort: 5 }]);
    expect((await planner.listPosts()).map((p) => p.caption)).toEqual(['A', 'B']);
    expect(await code(planner.reorderPosts([{ id: a.id, sort: 100 }, { id: 'dddddddd-0000-4000-8000-00000000fffe', sort: 1 }]))).toBe('NOT_FOUND');
    expect((await planner.listPosts()).map((p) => p.caption)).toEqual(['A', 'B']);
  });

  it('optimistic concurrency: STALE for an old updated_at', async () => {
    const { planner, photoIds } = setup();
    const post = await planner.createPost({ photoIds: [photoIds[0]!] });
    await planner.updatePost(post.id, { caption: 'x' });
    expect(await code(planner.updatePost(post.id, { caption: 'y' }, { expectedUpdatedAt: post.updated_at }))).toBe('STALE');
    expect(await code(planner.markPosted(post.id, '2026-11-16T10:00:00.000Z', { expectedUpdatedAt: post.updated_at }))).toBe('STALE');
    expect(await code(planner.updatePost('dddddddd-0000-4000-8000-00000000fffe', { caption: 'y' }))).toBe('NOT_FOUND');
  });

  it('is not tracked: no pending change and no change_log line', async () => {
    const { world, planner, photoIds } = setup();
    const before = world.snapshot();
    const post = await planner.createPost({ photoIds: [photoIds[0]!], status: 'planned' });
    await planner.updatePost(post.id, { caption: 'x' });
    await planner.setPostPhotos(post.id, [photoIds[1]!]);
    await planner.markPosted(post.id, '2026-11-16T10:00:00.000Z');
    await planner.deletePost(post.id);
    const after = world.snapshot();
    expect(after.site).toEqual(before.site);
    expect(after.changeLog).toEqual(before.changeLog);
  });

  it('needs an admin session and supports failure injection', async () => {
    const out = setup({ signedIn: false });
    expect(await code(out.planner.listPosts())).toBe('UNAUTHENTICATED');
    const { world, planner } = setup();
    world.failNext('planner.listPosts', 'network');
    expect(await code(planner.listPosts())).toBe(NetworkError.name);
    world.failNext('*', new ApiError('NOT_ADMIN'));
    expect(await code(planner.deletePost('x'))).toBe('NOT_ADMIN');
    world.dropNetwork();
    expect(await code(planner.listPosts())).toBe(NetworkError.name);
  });

  it('seeds example posts: grid order, a carousel, a planned post without photos and a posted one that lost a photo', async () => {
    const { planner } = setup({ plannerSeed: true });
    const posts = await planner.listPosts();
    expect(posts).toHaveLength(9);
    const open = posts.filter((p) => p.status !== 'posted');
    expect(posts.slice(0, open.length)).toEqual(open);
    expect(posts.slice(open.length).every((p) => p.status === 'posted')).toBe(true);
    expect(posts.some((p) => p.photos.length > 1)).toBe(true);
    expect(posts.some((p) => p.status === 'planned' && p.photos.length === 0)).toBe(true);
    expect(posts.some((p) => p.status === 'posted' && p.photos.some((l) => l.sort === 3))).toBe(true);
    expect(new Set(posts.map((p) => p.id)).size).toBe(9);
  });
});
