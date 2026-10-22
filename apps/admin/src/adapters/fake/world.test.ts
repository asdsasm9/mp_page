import {
  CommitResponseSchema,
  DeleteResponseSchema,
  PublishResponseSchema,
  ReconcileResponseSchema,
  ReserveResponseSchema,
  StorageResponseSchema,
  allKeys,
  planUploadFiles,
  variantPlan,
  type PhotoVariants,
  type ReserveRequest,
} from '@mp/shared';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  AuthError,
  CatalogError,
  NetworkError,
  UploadAbortedError,
  UploadHttpError,
} from '../../ports';
import { FAKE_ADMIN, FAKE_OUTSIDER } from './auth';
import { createManualClock } from './clock';
import { fixtureSnapshot } from './fixture';
import { createFakeWorld, type FakeWorldOptions } from './world';

const W = 1200;
const H = 800;
const FILES_PER_PHOTO = 6; // master, 480, 720, 960, 1600 jpeg, og
const pid = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;

function variantsFor(bytes = 1000): PhotoVariants {
  const p = variantPlan(W, H);
  return {
    master: { w: p.master.w, h: p.master.h, bytes },
    webp: p.webp.map((e) => ({ tier: e.tier as 480, w: e.w, h: e.h, bytes })),
    jpeg: { w: p.jpeg.w, h: p.jpeg.h, bytes },
    og: { w: p.og.w, h: p.og.h, bytes },
  };
}
const PER = 1000 * FILES_PER_PHOTO;

function item(n: number, bytes = 1000): ReserveRequest['items'][number] {
  return {
    photo_id: pid(n),
    width: W,
    height: H,
    files: planUploadFiles(pid(n), W, H).map((f) => ({ kind: f.kind, ...(f.tier ? { tier: f.tier } : {}), bytes })),
  };
}
const commitBody = (n: number, albumId: string, bytes = 1000) => ({
  photo_id: pid(n),
  album_id: albumId,
  width: W,
  height: H,
  variants: variantsFor(bytes),
  bytes_total: bytes * FILES_PER_PHOTO,
});

async function setup(options: FakeWorldOptions = {}) {
  const clock = createManualClock();
  const world = createFakeWorld({ clock, signedIn: true, ...options });
  const { ports } = world;
  const category = await ports.catalog.createCategory({ slug: 'svatby', name: 'Svatby' });
  const album = await ports.catalog.createAlbum({ category_id: category.id, slug: 'one', title: 'One', published: true });
  return { world, ports, clock, category, album };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** reserve -> PUT every file -> commit, like the upload client will. */
async function addPhoto({ ports, album }: Setup, n: number, bytes = 1000) {
  const res = await ports.api.reserve({ album_id: album.id, items: [item(n, bytes)] });
  const first = res.items[0]!;
  if (!first.ok) throw new Error(`reserve refused: ${first.code}`);
  for (const target of first.uploads!) {
    await ports.upload.put(target, new Blob([new Uint8Array(bytes)]));
  }
  return ports.api.commit(commitBody(n, album.id, bytes));
}

describe('contract: responses parse with the shared zod schemas', () => {
  it('every Worker response matches its schema', async () => {
    const s = await setup();
    const storage = await s.ports.api.getStorage();
    expect(StorageResponseSchema.safeParse(storage).success).toBe(true);
    const reserve = await s.ports.api.reserve({ album_id: s.album.id, items: [item(1)] });
    expect(ReserveResponseSchema.safeParse(reserve).success).toBe(true);
    for (const t of reserve.items[0]!.uploads!) await s.ports.upload.put(t, new Blob([new Uint8Array(1000)]));
    const commit = await s.ports.api.commit(commitBody(1, s.album.id));
    expect(CommitResponseSchema.safeParse(commit).success).toBe(true);
    expect(ReconcileResponseSchema.safeParse(await s.ports.api.reconcile({})).success).toBe(true);
    const publish = await s.ports.api.publish();
    expect(PublishResponseSchema.safeParse(publish).success).toBe(true);
    const del = await s.ports.api.deletePhotos({ ids: [pid(1)] });
    expect(DeleteResponseSchema.safeParse(del).success).toBe(true);
  });

  it('requests are validated like the Worker does (plan mismatch is INVALID_ITEMS, bad id INVALID_ID)', async () => {
    const s = await setup();
    const bad = item(1);
    bad.files = bad.files.slice(1);
    await expect(s.ports.api.reserve({ album_id: s.album.id, items: [bad] })).rejects.toMatchObject({ code: 'INVALID_ITEMS' });
    await expect(s.ports.api.reserve({ album_id: 'nope', items: [item(1)] })).rejects.toMatchObject({ code: 'INVALID_ID' });
    await expect(s.ports.api.deletePhotos({ ids: Array.from({ length: 201 }, (_, i) => pid(i + 1)) })).rejects.toMatchObject({
      code: 'BATCH_TOO_LARGE',
    });
  });
});

describe('catalog.getAppConfig', () => {
  it('returns the configured limits as the app_config row, follows setLimits, needs a session', async () => {
    const s = await setup({ limits: { maxFilesPerBatch: 7 } });
    expect(await s.ports.catalog.getAppConfig()).toEqual({
      id: true,
      quota_hard_bytes: 9_500_000_000,
      quota_warn_bytes: 8_000_000_000,
      max_upload_bytes: 41_943_040,
      max_files_per_batch: 7,
      reservation_ttl_min: 60,
    });
    s.world.setLimits({ maxUploadBytes: 123 });
    expect((await s.ports.catalog.getAppConfig()).max_upload_bytes).toBe(123);
    await s.ports.auth.signOut();
    await expect(s.ports.catalog.getAppConfig()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('quota guard (apps/api/test/quota-guard.test.ts, replayed)', () => {
  it('refuses a reserve that would cross the hard limit and issues no URL', async () => {
    const s = await setup({ limits: { quotaHardBytes: PER - 1, quotaWarnBytes: 10 } });
    const res = await s.ports.api.reserve({ album_id: s.album.id, items: [item(1)] });
    expect(res.items[0]).toEqual({ photo_id: pid(1), ok: false, code: 'STORAGE_FULL' });
    expect(res.items[0]!.uploads).toBeUndefined();
    expect((await s.ports.api.getStorage()).reserved_bytes).toBe(0);
  });

  it('accepts a reserve exactly at the limit and just under it', async () => {
    const exact = await setup({ limits: { quotaHardBytes: PER, quotaWarnBytes: 10 } });
    const res = await exact.ports.api.reserve({ album_id: exact.album.id, items: [item(1)] });
    expect(res.items[0]!.ok).toBe(true);
    expect(res.items[0]!.uploads).toHaveLength(FILES_PER_PHOTO);
    expect(res.level).toBe('full');
    const under = await setup({ limits: { quotaHardBytes: PER + 1, quotaWarnBytes: 10 } });
    expect((await under.ports.api.reserve({ album_id: under.album.id, items: [item(1)] })).items[0]!.ok).toBe(true);
  });

  it('first-fit: a refused big photo does not block a later small one', async () => {
    const s = await setup({ limits: { quotaHardBytes: PER + 10, quotaWarnBytes: 10 } });
    const res = await s.ports.api.reserve({ album_id: s.album.id, items: [item(1, 5000), item(2, 1000)] });
    expect(res.items.map((i) => i.ok)).toEqual([false, true]);
    expect(res.items[0]!.code).toBe('STORAGE_FULL');
    expect(res.reserved_bytes).toBe(PER);
  });

  it('level follows the configured thresholds', async () => {
    const s = await setup();
    await addPhoto(s, 1);
    s.world.setLimits({ quotaHardBytes: PER + 10, quotaWarnBytes: PER + 1 });
    expect((await s.ports.api.getStorage()).level).toBe('ok');
    s.world.setLimits({ quotaWarnBytes: PER });
    expect((await s.ports.api.getStorage()).level).toBe('warn');
    s.world.setLimits({ quotaHardBytes: PER, quotaWarnBytes: PER - 5 });
    const full = await s.ports.api.getStorage();
    expect(full).toMatchObject({ level: 'full', hard: PER, warn: PER - 5, used_bytes: PER, photo_count: 1 });
  });

  it('limits come from configuration: lowering and restoring changes the result', async () => {
    const s = await setup();
    expect((await s.ports.api.reserve({ album_id: s.album.id, items: [item(1)] })).items[0]!.ok).toBe(true);
    s.world.setLimits({ quotaHardBytes: 100, quotaWarnBytes: 50 });
    expect((await s.ports.api.reserve({ album_id: s.album.id, items: [item(2)] })).items[0]!.ok).toBe(false);
    s.world.setLimits({ quotaHardBytes: 9_500_000_000, quotaWarnBytes: 8_000_000_000 });
    expect((await s.ports.api.reserve({ album_id: s.album.id, items: [item(2)] })).items[0]!.ok).toBe(true);
  });

  it('per-file and per-batch limits come from configuration', async () => {
    const s = await setup({ limits: { maxUploadBytes: 7000, maxFilesPerBatch: 2 } });
    // item 1: one file over the limit; item 2: every file fine but the photo total (12000) is over it too
    const oneBigFile = item(1, 1000);
    oneBigFile.files[0]!.bytes = 8000;
    const res = await s.ports.api.reserve({ album_id: s.album.id, items: [oneBigFile, item(2, 2000), item(3, 1000)] }).catch((e: unknown) => e);
    expect(res).toMatchObject({ code: 'BATCH_TOO_LARGE', status: 413 });
    const ok = await s.ports.api.reserve({ album_id: s.album.id, items: [oneBigFile, item(2, 2000)] });
    expect(ok.items.map((i) => i.code ?? 'ok')).toEqual(['FILE_TOO_LARGE', 'FILE_TOO_LARGE']);
    expect((await s.ports.api.reserve({ album_id: s.album.id, items: [item(4, 1000)] })).items[0]!.ok).toBe(true);
    await expect(
      s.ports.api.reserve({ album_id: s.album.id, items: [item(3), item(4), item(5)] }),
    ).rejects.toMatchObject({ code: 'BATCH_TOO_LARGE', status: 413 });
  });

  it('two batches cannot both take the last bytes; the second gets the all-refused body', async () => {
    const s = await setup({ limits: { quotaHardBytes: PER, quotaWarnBytes: 10 } });
    const a = await s.ports.api.reserve({ album_id: s.album.id, items: [item(1)] });
    const b = await s.ports.api.reserve({ album_id: s.album.id, items: [item(2)] });
    expect(a.items[0]!.ok).toBe(true);
    expect(b.items[0]!).toEqual({ photo_id: pid(2), ok: false, code: 'STORAGE_FULL' });
    expect(b.reserved_bytes).toBe(PER);
  });

  it('reservations expire after reservation_ttl_min', async () => {
    const s = await setup({ limits: { quotaHardBytes: PER, quotaWarnBytes: 10, reservationTtlMin: 60 } });
    await s.ports.api.reserve({ album_id: s.album.id, items: [item(1)] });
    expect((await s.ports.api.getStorage()).reserved_bytes).toBe(PER);
    await s.clock.advance(61 * 60_000);
    expect((await s.ports.api.getStorage()).reserved_bytes).toBe(0);
    expect((await s.ports.api.reserve({ album_id: s.album.id, items: [item(2)] })).items[0]!.ok).toBe(true);
  });

  it('unknown album and existing photo id are refused', async () => {
    const s = await setup();
    await expect(
      s.ports.api.reserve({ album_id: pid(999), items: [item(1)] }),
    ).rejects.toMatchObject({ code: 'ALBUM_NOT_FOUND' });
    await addPhoto(s, 1);
    await expect(s.ports.api.reserve({ album_id: s.album.id, items: [item(1)] })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('commit and delete', () => {
  it('commit is idempotent: the second call returns the same row and changes nothing', async () => {
    const s = await setup();
    const first = await addPhoto(s, 1);
    expect(first.already_existed).toBe(false);
    expect(first.photo).toMatchObject({ id: pid(1), album_id: s.album.id, sort: 10, master_key: `photos/${pid(1)}/master.jpg` });
    const pending = (await s.ports.catalog.getSiteState()).pending_changes;
    const again = await s.ports.api.commit(commitBody(1, s.album.id));
    expect(again.already_existed).toBe(true);
    expect(again.photo).toEqual(first.photo);
    expect((await s.ports.api.getStorage()).used_bytes).toBe(PER);
    expect((await s.ports.catalog.getSiteState()).pending_changes).toBe(pending);
    expect((await addPhoto(s, 2)).photo.sort).toBe(20);
  });

  it('commit of an existing id into another album is CONFLICT', async () => {
    const s = await setup();
    await addPhoto(s, 1);
    const other = await s.ports.catalog.createAlbum({ category_id: s.category.id, slug: 'two', title: 'Two' });
    await expect(s.ports.api.commit(commitBody(1, other.id))).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
  });

  it('commit into an unknown album is ALBUM_NOT_FOUND and removes the uploaded objects', async () => {
    const s = await setup();
    const res = await s.ports.api.reserve({ album_id: s.album.id, items: [item(1)] });
    for (const t of res.items[0]!.uploads!) await s.ports.upload.put(t, new Blob([new Uint8Array(1000)]));
    await expect(s.ports.api.commit(commitBody(1, pid(900)))).rejects.toMatchObject({ code: 'ALBUM_NOT_FOUND', status: 404 });
    expect(s.world.snapshot().objects).toEqual([]);
  });

  it('commit without the objects, or with the wrong sizes, is KEY_MISMATCH and leaves nothing behind', async () => {
    const s = await setup();
    await s.ports.api.reserve({ album_id: s.album.id, items: [item(1)] });
    await expect(s.ports.api.commit(commitBody(1, s.album.id))).rejects.toMatchObject({ code: 'KEY_MISMATCH', status: 422 });
    expect((await s.ports.catalog.listPhotos(s.album.id))).toHaveLength(0);
  });

  it('commit is refused when the bucket accepted more than was reserved (presign did not enforce length)', async () => {
    const s = await setup({ enforceContentLength: false });
    const res = await s.ports.api.reserve({ album_id: s.album.id, items: [item(1, 100)] });
    for (const t of res.items[0]!.uploads!) await s.ports.upload.put(t, new Blob([new Uint8Array(1000)]));
    await expect(s.ports.api.commit(commitBody(1, s.album.id, 1000))).rejects.toMatchObject({ code: 'KEY_MISMATCH' });
    expect(s.world.snapshot().objects).toEqual([]);
    expect(s.world.snapshot().photos).toEqual([]);
  });

  it('expired reservation, commit larger than reserved', async () => {
    const s = await setup({ enforceContentLength: false });
    const res = await s.ports.api.reserve({ album_id: s.album.id, items: [item(1, 100)] });
    for (const t of res.items[0]!.uploads!) await s.ports.upload.put(t, new Blob([new Uint8Array(1000)]));
    s.clock.advance(61 * 60_000); // past the 60 minute reservation TTL; the row lingers until the next reserve
    await expect(s.ports.api.commit(commitBody(1, s.album.id, 1000))).rejects.toMatchObject({ code: 'KEY_MISMATCH' });
    expect(s.world.snapshot().photos).toEqual([]);
  });

  it('commit with a wrong bytes_total is refused before any row exists', async () => {
    const s = await setup();
    const res = await s.ports.api.reserve({ album_id: s.album.id, items: [item(1)] });
    for (const t of res.items[0]!.uploads!) await s.ports.upload.put(t, new Blob([new Uint8Array(1000)]));
    await expect(s.ports.api.commit({ ...commitBody(1, s.album.id), bytes_total: PER + 1 })).rejects.toBeInstanceOf(ApiError);
    expect(s.world.snapshot().photos).toEqual([]);
  });

  it('deleting photos lowers usage, removes the objects, and re-allows an upload', async () => {
    const s = await setup({ limits: { quotaHardBytes: PER, quotaWarnBytes: PER - 5 } });
    await addPhoto(s, 1);
    expect((await s.ports.api.reserve({ album_id: s.album.id, items: [item(2)] })).items[0]!.ok).toBe(false);
    const del = await s.ports.api.deletePhotos({ ids: [pid(1), pid(1), pid(77)] });
    expect(del).toEqual({ deleted: 1, objectsDeleted: FILES_PER_PHOTO, failed: [], publishRecommended: true });
    expect((await s.ports.api.getStorage()).used_bytes).toBe(0);
    expect(s.world.snapshot().objects).toEqual([]);
    expect((await s.ports.api.reserve({ album_id: s.album.id, items: [item(2)] })).items[0]!.ok).toBe(true);
  });

  it('deleting the cover photo clears the cover', async () => {
    const s = await setup();
    await addPhoto(s, 1);
    await s.ports.catalog.updateAlbum(s.album.id, { cover_photo_id: pid(1) });
    await s.ports.api.deletePhotos({ ids: [pid(1)] });
    expect((await s.ports.catalog.getAlbum(s.album.id))!.cover_photo_id).toBeNull();
  });
});

describe('catalog rules and pending_changes', () => {
  it('every changed row counts once; publishing subtracts what it saw', async () => {
    const s = await setup();
    expect((await s.ports.catalog.getSiteState()).pending_changes).toBe(2); // category + album
    await addPhoto(s, 1);
    await s.ports.catalog.updatePhoto(pid(1), { alt: 'Nevěsta' });
    expect((await s.ports.catalog.getSiteState()).pending_changes).toBe(4);
    const published = await s.ports.api.publish();
    expect(published.pending_seen).toBe(4);
    expect((await s.ports.catalog.getSiteState()).pending_changes).toBe(0);
    await s.ports.catalog.updateAlbum(s.album.id, { title: 'Dva' });
    expect((await s.ports.catalog.getSiteState()).pending_changes).toBe(1);
  });

  it('change log: one line per row with the trigger rules of migration 20261022160000, cleared by publish', async () => {
    const s = await setup();
    const log = async () => (await s.ports.catalog.listChangeLog()).map((l) => `${l.table_name}:${l.kind}:${l.label}`);
    expect(await log()).toEqual(['albums:added:One', 'categories:added:Svatby']);
    await addPhoto(s, 1);
    await s.ports.catalog.updatePhoto(pid(1), { alt: 'Nevěsta' });
    await s.clock.advance(1000);
    await s.ports.catalog.updateAlbum(s.album.id, { title: 'Dva' });
    // added stays added, label refreshed, the album line moved to the front (newest first).
    expect(await log()).toEqual(['albums:added:Dva', 'photos:added:Nevěsta', 'categories:added:Svatby']);
    expect((await s.ports.catalog.listChangeLog())[1]).toMatchObject({ category_name: 'Svatby', album_title: 'One' });

    await s.ports.api.publish();
    expect(await log()).toEqual([]);

    // After the publish: sort only is "reordered", a no-op is not logged, then a content edit upgrades it.
    await s.ports.catalog.updatePhoto(pid(1), { sort: 77 });
    expect(await log()).toEqual(['photos:reordered:Nevěsta']);
    await s.ports.catalog.updatePhoto(pid(1), { sort: 77 });
    await s.ports.catalog.updatePhoto(pid(1), { caption: 'Podpis' });
    expect(await log()).toEqual(['photos:edited:Nevěsta']);

    // Added and deleted before a publish cancel out; a published row deleted is a "deleted" line.
    await addPhoto(s, 2);
    await s.ports.api.deletePhotos({ ids: [pid(2)] });
    expect(await log()).toEqual(['photos:edited:Nevěsta']);
    await s.ports.api.deletePhotos({ ids: [pid(1)] });
    expect(await log()).toEqual(['photos:deleted:Nevěsta']);
  });

  it('change log: lines written after the publish request stay, a failed publish keeps all', async () => {
    const s = await setup();
    s.world.failNext('api.publish', new ApiError('PUBLISH_FAILED'));
    await expect(s.ports.api.publish()).rejects.toMatchObject({ code: 'PUBLISH_FAILED' });
    expect(await s.ports.catalog.listChangeLog()).toHaveLength(2);
    await s.clock.advance(61_000);
    await s.ports.api.publish();
    await s.clock.advance(1000);
    await s.ports.catalog.updateCategory(s.category.id, { name: 'Svatby 2' });
    expect((await s.ports.catalog.listChangeLog()).map((l) => l.label)).toEqual(['Svatby 2']);
  });

  it('enforces slug rules, uniqueness and the reserved category slugs', async () => {
    const s = await setup();
    await expect(s.ports.catalog.createCategory({ slug: 'portfolio', name: 'x' })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(s.ports.catalog.createCategory({ slug: 'Bad Slug', name: 'x' })).rejects.toBeInstanceOf(CatalogError);
    await expect(s.ports.catalog.createCategory({ slug: 'svatby', name: 'x' })).rejects.toMatchObject({ code: 'DUPLICATE_SLUG' });
    await expect(
      s.ports.catalog.createAlbum({ category_id: s.category.id, slug: 'one', title: 'x' }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_SLUG' });
  });

  it('optimistic concurrency: a stale updated_at is refused', async () => {
    const s = await setup();
    const loaded = (await s.ports.catalog.getAlbum(s.album.id))!;
    await s.ports.catalog.updateAlbum(s.album.id, { place: 'Brno' }, { expectedUpdatedAt: loaded.updated_at });
    await expect(
      s.ports.catalog.updateAlbum(s.album.id, { place: 'Praha' }, { expectedUpdatedAt: loaded.updated_at }),
    ).rejects.toMatchObject({ code: 'STALE' });
    expect((await s.ports.catalog.getAlbum(s.album.id))!.place).toBe('Brno');
  });

  it('photos accept only album_id, sort, alt and caption; a cover must belong to its album', async () => {
    const s = await setup();
    await addPhoto(s, 1);
    await expect(
      s.ports.catalog.updatePhoto(pid(1), { bytes_total: 1 } as never),
    ).rejects.toMatchObject({ code: 'INVALID' });
    await expect(s.ports.catalog.updateAlbum(s.album.id, { cover_photo_id: pid(55) })).rejects.toMatchObject({
      code: 'COVER_NOT_IN_ALBUM',
    });
    const other = await s.ports.catalog.createAlbum({ category_id: s.category.id, slug: 'two', title: 'Two' });
    await s.ports.catalog.updateAlbum(s.album.id, { cover_photo_id: pid(1) });
    await s.ports.catalog.updatePhoto(pid(1), { album_id: other.id });
    expect((await s.ports.catalog.getAlbum(s.album.id))!.cover_photo_id).toBeNull();
  });

  it('a category with albums and an album with photos cannot be deleted', async () => {
    const s = await setup();
    await addPhoto(s, 1);
    await expect(s.ports.catalog.deleteCategory(s.category.id)).rejects.toMatchObject({ code: 'IN_USE' });
    await expect(s.ports.catalog.deleteAlbum(s.album.id)).rejects.toMatchObject({ code: 'IN_USE' });
    await s.ports.api.deletePhotos({ ids: [pid(1)] });
    await s.ports.catalog.deleteAlbum(s.album.id);
    await s.ports.catalog.deleteCategory(s.category.id);
    expect(await s.ports.catalog.listCategories()).toEqual([]);
  });

  it('lists come back ordered by sort then id and are copies', async () => {
    const s = await setup();
    await s.ports.catalog.createCategory({ slug: 'portrety', name: 'Portréty', sort: -10 });
    const rows = await s.ports.catalog.listCategories();
    expect(rows.map((r) => r.slug)).toEqual(['portrety', 'svatby']);
    rows[0]!.name = 'changed';
    expect((await s.ports.catalog.listCategories())[0]!.name).toBe('Portréty');
  });

  it('a non-admin account sees nothing', async () => {
    const world = createFakeWorld({ clock: createManualClock() });
    world.google.next = 'outsider';
    await world.ports.auth.signInWithGoogle({ returnTo: '/' });
    expect((await world.ports.auth.getSession())?.email).toBe(FAKE_OUTSIDER.email);
    expect(await world.ports.auth.isAdmin()).toBe(false);
    await expect(world.ports.catalog.listCategories()).rejects.toMatchObject({ code: 'NOT_ADMIN' });
  });
});

describe('publish', () => {
  it('a second publish within 60 s is PUBLISH_TOO_SOON with the seconds left', async () => {
    const s = await setup();
    await s.ports.api.publish();
    await s.clock.advance(20_000);
    const err = await s.ports.api.publish().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'PUBLISH_TOO_SOON', status: 429, retryAfter: 40 });
    await s.clock.advance(40_000);
    await expect(s.ports.api.publish()).resolves.toMatchObject({ counts: { albums: 1 } });
  });

  it('publishing with no published album is SNAPSHOT_EMPTY and logs a failure', async () => {
    const s = await setup();
    await s.ports.catalog.updateAlbum(s.album.id, { published: false });
    await expect(s.ports.api.publish()).rejects.toMatchObject({ code: 'SNAPSHOT_EMPTY', status: 409 });
    const log = await s.ports.catalog.listPublishLog(10);
    expect(log[0]).toMatchObject({ status: 'failed', error: 'SNAPSHOT_EMPTY' });
    expect((await s.ports.catalog.getSiteState()).pending_changes).toBeGreaterThan(0);
  });

  it('PUBLISH_FAILED keeps pending_changes and still spends the rate limit', async () => {
    const s = await setup();
    s.world.failNext('api.publish', new ApiError('PUBLISH_FAILED'));
    await expect(s.ports.api.publish()).rejects.toMatchObject({ code: 'PUBLISH_FAILED', status: 502 });
    expect((await s.ports.catalog.getSiteState()).pending_changes).toBe(2);
    expect((await s.ports.catalog.listPublishLog(1))[0]!.status).toBe('failed');
    await expect(s.ports.api.publish()).rejects.toMatchObject({ code: 'PUBLISH_TOO_SOON' });
  });

  it('/_publish.json shows the new snapshot only after the build delay; the log keeps the last 10 newest first', async () => {
    const s = await setup({ buildDelayMs: 90_000 });
    expect(await s.ports.publishStatus.read()).toBeNull();
    const res = await s.ports.api.publish();
    await s.clock.advance(60_000);
    expect(await s.ports.publishStatus.read()).toBeNull();
    await s.clock.advance(30_000);
    expect(await s.ports.publishStatus.read()).toMatchObject({ snapshotGeneratedAt: res.snapshot_generated_at });
    for (let i = 0; i < 11; i++) {
      await s.clock.advance(60_000);
      await s.ports.api.publish();
    }
    const log = await s.ports.catalog.listPublishLog(10);
    expect(log).toHaveLength(10);
    expect(log.every((r) => r.status === 'ok')).toBe(true);
    expect(log[0]!.requested_at > log[9]!.requested_at).toBe(true);
  });

  it('with no build delay the new snapshot never shows (publish timeout scenario)', async () => {
    const s = await setup({ buildDelayMs: null });
    await s.ports.api.publish();
    await s.clock.advance(10 * 60_000);
    expect(await s.ports.publishStatus.read()).toBeNull();
  });
});

describe('failure injection', () => {
  it('failNext fails exactly the next call of that operation', async () => {
    const s = await setup();
    s.world.failNext('api.getStorage', new ApiError('UPSTREAM_ERROR'));
    await expect(s.ports.catalog.listCategories()).resolves.toHaveLength(1);
    await expect(s.ports.api.getStorage()).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', status: 502 });
    await expect(s.ports.api.getStorage()).resolves.toMatchObject({ level: 'ok' });
  });

  it('failNext supports a count, "network", and the wildcard', async () => {
    const s = await setup();
    s.world.failNext('api.getStorage', 'network', 2);
    await expect(s.ports.api.getStorage()).rejects.toBeInstanceOf(NetworkError);
    await expect(s.ports.api.getStorage()).rejects.toBeInstanceOf(NetworkError);
    await expect(s.ports.api.getStorage()).resolves.toBeDefined();
    s.world.failNext('*', new CatalogError('INVALID'));
    await expect(s.ports.catalog.listAlbums()).rejects.toMatchObject({ code: 'INVALID' });
    expect(s.world.snapshot().queuedFailures).toBe(0);
  });

  it('failNext can fail a PUT and a sign-in', async () => {
    const s = await setup();
    s.world.failNext('upload.put', new UploadHttpError(500));
    const res = await s.ports.api.reserve({ album_id: s.album.id, items: [item(1)] });
    const target = res.items[0]!.uploads![0]!;
    await expect(s.ports.upload.put(target, new Blob([new Uint8Array(1000)]))).rejects.toMatchObject({ status: 500 });
    await expect(s.ports.upload.put(target, new Blob([new Uint8Array(1000)]))).resolves.toBeUndefined();
    s.world.failNext('auth.signInWithGoogle', new AuthError('TOO_MANY_ATTEMPTS'));
    await expect(s.ports.auth.signInWithGoogle({ returnTo: '/' })).rejects.toMatchObject({ code: 'TOO_MANY_ATTEMPTS' });
  });

  it('dropNetwork fails every call with NetworkError until switched off', async () => {
    const s = await setup();
    s.world.dropNetwork();
    await expect(s.ports.api.getStorage()).rejects.toBeInstanceOf(NetworkError);
    await expect(s.ports.catalog.listCategories()).rejects.toBeInstanceOf(NetworkError);
    await expect(s.ports.publishStatus.read()).rejects.toBeInstanceOf(NetworkError);
    await expect(s.ports.upload.put({ url: 'x', method: 'PUT', headers: {} }, new Blob([]))).rejects.toBeInstanceOf(NetworkError);
    s.world.dropNetwork(false);
    await expect(s.ports.api.getStorage()).resolves.toBeDefined();
  });

  it('expireSession answers 401 and drops the session until the next sign-in', async () => {
    const s = await setup();
    const seen: (string | null)[] = [];
    s.ports.auth.onAuthChange((session) => seen.push(session?.email ?? null));
    s.world.expireSession();
    expect(seen).toEqual([null]);
    expect(await s.ports.auth.getSession()).toBeNull();
    await expect(s.ports.api.getStorage()).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    await expect(s.ports.catalog.listCategories()).rejects.toMatchObject({ status: 401 });
    await s.ports.auth.signInWithGoogle({ returnTo: '/' });
    expect(seen).toEqual([null, FAKE_ADMIN.email]);
    await expect(s.ports.api.getStorage()).resolves.toBeDefined();
  });

  it('slowPut holds a PUT until the clock advances, reports progress, and can be aborted', async () => {
    const s = await setup();
    const res = await s.ports.api.reserve({ album_id: s.album.id, items: [item(1), item(2)] });
    s.world.slowPut(5000);
    const progress: number[] = [];
    let done = false;
    const slow = s.ports.upload
      .put(res.items[0]!.uploads![0]!, new Blob([new Uint8Array(1000)]), { onProgress: (l) => progress.push(l) })
      .then(() => (done = true));
    await s.clock.advance(4999);
    expect(done).toBe(false);
    await s.clock.advance(1);
    await slow;
    expect(done).toBe(true);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1000);

    const controller = new AbortController();
    const aborted = s.ports.upload.put(res.items[1]!.uploads![0]!, new Blob([new Uint8Array(1000)]), { signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toBeInstanceOf(UploadAbortedError);
    expect(s.world.snapshot().objects.map((o) => o.key)).toEqual([res.items[0]!.uploads![0]!.key]);
    s.world.slowPut(null);
  });

  it('snapshot() is plain data without tokens', async () => {
    const s = await setup();
    await addPhoto(s, 1);
    const text = JSON.stringify(s.world.snapshot());
    expect(text).not.toContain('fake-token');
    expect(s.world.snapshot()).toMatchObject({ signedInAs: FAKE_ADMIN.email, photos: [{ id: pid(1) }] });
    expect(JSON.parse(text)).toEqual(s.world.snapshot());
  });
});

describe('presigned PUT', () => {
  it('rejects tampered headers, a wrong length and an expired URL; stores the size on success', async () => {
    const s = await setup();
    const res = await s.ports.api.reserve({ album_id: s.album.id, items: [item(1)] });
    const target = res.items[0]!.uploads![0]!;
    const body = new Blob([new Uint8Array(1000)]);
    await expect(s.ports.upload.put({ ...target, headers: { ...target.headers, 'content-type': 'image/png' } }, body)).rejects.toMatchObject({ status: 403 });
    await expect(s.ports.upload.put(target, new Blob([new Uint8Array(999)]))).rejects.toMatchObject({ status: 403 });
    await expect(s.ports.upload.put({ ...target, url: `${target.url}x` }, body)).rejects.toMatchObject({ status: 403 });
    await s.ports.upload.put(target, body);
    expect(s.world.snapshot().objects).toEqual([{ key: target.key, bytes: 1000 }]);
    const late = res.items[0]!.uploads![1]!;
    await s.clock.advance(15 * 60_000 + 1);
    await expect(s.ports.upload.put(late, body)).rejects.toMatchObject({ status: 403 });
  });

  it('a target carries the signed headers, the planned keys and the fixed cache-control', async () => {
    const s = await setup();
    const res = await s.ports.api.reserve({ album_id: s.album.id, items: [item(1)] });
    const keys = res.items[0]!.uploads!.map((u) => u.key).sort();
    expect(keys).toEqual(allKeys(pid(1), variantsFor()).sort());
    expect(res.items[0]!.uploads![0]!.headers).toMatchObject({
      'cache-control': 'public, max-age=31536000, immutable',
      'content-length': '1000',
    });
  });
});

describe('reconcile', () => {
  it('walks two pages by cursor and the pages add up to one full run', async () => {
    const s = await setup({ reconcilePageObjects: 6 });
    await addPhoto(s, 1);
    await addPhoto(s, 2);
    await addPhoto(s, 3);
    const first = await s.ports.api.reconcile({});
    expect(first.cursor).toBeDefined();
    let totals = { objects: first.r2.objects, photos: first.db.photos, bytes: first.r2.bytes };
    let cursor = first.cursor;
    let pages = 1;
    while (cursor) {
      const next = await s.ports.api.reconcile({ cursor });
      totals = { objects: totals.objects + next.r2.objects, photos: totals.photos + next.db.photos, bytes: totals.bytes + next.r2.bytes };
      cursor = next.cursor;
      pages++;
    }
    expect(pages).toBeGreaterThan(1);
    expect(totals).toEqual({ objects: 3 * FILES_PER_PHOTO, photos: 3, bytes: 3 * PER });
  });

  it('reports orphans older than 2 hours and deletes them only with apply: true', async () => {
    const s = await setup();
    await addPhoto(s, 1);
    const hour = 3_600_000;
    s.world.putObject(`photos/${pid(50)}/master.jpg`, 500, 3 * hour);
    s.world.putObject(`photos/${pid(51)}/master.jpg`, 500, 1 * hour); // too young
    const report = await s.ports.api.reconcile({});
    expect(report.orphans).toEqual([{ id: pid(50), objects: 1, bytes: 500 }]);
    expect(report).toMatchObject({ applied: false, deleted: 0, missing: [], sizeMismatch: [] });
    expect(s.world.snapshot().objects.some((o) => o.key.includes(pid(50)))).toBe(true);
    const applied = await s.ports.api.reconcile({ apply: true });
    expect(applied).toMatchObject({ applied: true, deleted: 1 });
    expect(s.world.snapshot().objects.some((o) => o.key.includes(pid(50)))).toBe(false);
    expect(s.world.snapshot().objects.some((o) => o.key.includes(pid(51)))).toBe(true);
  });

  it('reports missing objects and size mismatches without touching anything', async () => {
    const s = await setup();
    await addPhoto(s, 1);
    await addPhoto(s, 2);
    const one = allKeys(pid(1), variantsFor());
    const two = allKeys(pid(2), variantsFor());
    s.world.putObject(one[0]!, 7); // wrong size
    s.world.removeObject(two[1]!); // gone
    const before = s.world.snapshot().objects.length;
    const report = await s.ports.api.reconcile({ apply: true });
    expect(report.sizeMismatch).toEqual([{ id: pid(1), key: one[0], expected: 1000, actual: 7 }]);
    expect(report.missing).toEqual([{ id: pid(2), keys: [two[1]] }]);
    expect(report).toMatchObject({ orphans: [], deleted: 0 });
    expect(s.world.snapshot().objects).toHaveLength(before);
  });
});

describe('fixture seed', () => {
  it('starts from the shared snapshot fixture, with a consistent bucket and published state', async () => {
    const snapshot = fixtureSnapshot();
    const world = createFakeWorld({ clock: createManualClock(), seed: snapshot, signedIn: true });
    const { ports } = world;
    expect((await ports.catalog.listCategories()).length).toBe(snapshot.counts.categories);
    expect((await ports.catalog.listAlbums()).length).toBe(snapshot.counts.albums);
    const storage = await ports.api.getStorage();
    expect(storage.photo_count).toBe(snapshot.counts.photos);
    expect(storage.level).toBe('ok');
    expect((await ports.catalog.getSiteState()).pending_changes).toBe(0);
    expect((await ports.publishStatus.read())!.snapshotGeneratedAt).toBe(snapshot.generatedAt);
    const report = await ports.api.reconcile({});
    expect(report).toMatchObject({ orphans: [], missing: [], sizeMismatch: [], unknownKeys: [] });
    expect(report.db.photos).toBe(snapshot.counts.photos);
    expect(report.db.bytes).toBe(storage.used_bytes);
    expect(report.r2.bytes).toBe(storage.used_bytes);
  });
});
