// Contract tests for FakeBackend: it must refuse and accept what the Worker does (plan WP-06 step 2).
import { describe, expect, it } from 'vitest';
import {
  allKeys,
  sumBytes,
  variantPlan,
  type CommitRequest,
  type PhotoVariants,
  type ReserveRequest,
  type UploadTarget,
} from '../../packages/shared/src';
import { BackendError } from './backend';
import { createFakeBackend, type FakeBackend, type FakeBackendOptions } from './fake-backend';

const CAT = '11111111-1111-4111-8111-111111111111';
const ALBUM = '22222222-2222-4222-8222-222222222222';
const id = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;

/** Variants for a master of w x h with a fixed fake size per file. */
function variantsFor(w: number, h: number, size = 1000): PhotoVariants {
  const p = variantPlan(w, h);
  const d = (s: { w: number; h: number }) => ({ w: s.w, h: s.h, bytes: size });
  return { master: d(p.master), webp: p.webp.map((e) => ({ ...d(e), tier: e.tier as 480 })), jpeg: d(p.jpeg), og: d(p.og) };
}

function reserveRequest(photoId: string, w: number, h: number, v: PhotoVariants): ReserveRequest {
  const files: ReserveRequest['items'][number]['files'] = [
    { kind: 'master', bytes: v.master.bytes },
    ...v.webp.map((e) => ({ kind: 'webp' as const, tier: e.tier, bytes: e.bytes })),
    { kind: 'jpeg', bytes: v.jpeg.bytes },
    { kind: 'og', bytes: v.og.bytes },
  ];
  return { album_id: ALBUM, items: [{ photo_id: photoId, width: w, height: h, files }] };
}

function commitRequest(photoId: string, w: number, h: number, v: PhotoVariants, extra: Partial<CommitRequest> = {}): CommitRequest {
  return { photo_id: photoId, album_id: ALBUM, width: w, height: h, variants: v, bytes_total: sumBytes(v), ...extra };
}

async function ready(options: FakeBackendOptions = {}): Promise<FakeBackend> {
  const b = createFakeBackend(options);
  await b.signIn();
  await b.upsertCategory({ id: CAT, slug: 'weddings', name: 'Svatby', sort: 10 });
  await b.upsertAlbum({ id: ALBUM, category_id: CAT, slug: 'a', title: 'A', place: null, sort: 10, legacy_id: 'a', published: true });
  return b;
}

async function putAll(b: FakeBackend, uploads: UploadTarget[], size = 1000) {
  for (const u of uploads) await b.put(u, new Uint8Array(size));
}

/** reserve, PUT, commit one photo. */
async function addPhoto(b: FakeBackend, photoId: string, w = 2000, h = 1500, extra: Partial<CommitRequest> = {}) {
  const v = variantsFor(w, h);
  const r = await b.reserve(reserveRequest(photoId, w, h, v));
  const item = r.items[0]!;
  if (!item.ok) throw new BackendError(item.code!);
  await putAll(b, item.uploads!);
  return b.commit(commitRequest(photoId, w, h, v, extra));
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof BackendError) return e.code;
    throw e;
  }
  return 'NO_ERROR';
}

describe('FakeBackend contract', () => {
  it('refuses a wrong tier set, a missing 720 and a bad key like the Worker', async () => {
    const b = await ready();
    const v = variantsFor(2000, 1500);
    const base = reserveRequest(id(1), 2000, 1500, v);
    const item = base.items[0]!;

    const without720 = { ...base, items: [{ ...item, files: item.files.filter((f) => f.tier !== 720) }] };
    expect(await codeOf(b.reserve(without720))).toBe('INVALID_ITEMS');

    const extraTier = { ...base, items: [{ ...item, files: [...item.files, { kind: 'webp' as const, tier: 2400 as const, bytes: 10 }] }] };
    expect(await codeOf(b.reserve(extraTier))).toBe('INVALID_ITEMS');

    expect(await codeOf(b.reserve(reserveRequest('../etc/passwd', 2000, 1500, v)))).toBe('INVALID_ID');

    // commit: variants that do not match the plan, bad legacy key, objects that were never uploaded
    const noWebp720 = { ...v, webp: v.webp.filter((e) => e.tier !== 720) };
    expect(await codeOf(b.commit(commitRequest(id(1), 2000, 1500, noWebp720)))).toBe('INVALID_REQUEST');
    expect(await codeOf(b.commit(commitRequest(id(1), 2000, 1500, v, { legacy_key: '../x.jpg' })))).toBe('INVALID_REQUEST');
    expect(await codeOf(b.commit(commitRequest(id(1), 2000, 1500, v)))).toBe('KEY_MISMATCH');
    expect(b.photos()).toHaveLength(0);
  });

  it('refuses a commit whose bytes_total is not the sum, and cleans up the objects', async () => {
    const b = await ready();
    const v = variantsFor(2000, 1500);
    const r = await b.reserve(reserveRequest(id(1), 2000, 1500, v));
    await putAll(b, r.items[0]!.uploads!);
    expect(b.storageFake.keys()).toHaveLength(allKeys(id(1), v).length);
    expect(await codeOf(b.commit(commitRequest(id(1), 2000, 1500, v, { bytes_total: sumBytes(v) + 1 })))).toBe('KEY_MISMATCH');
    expect(b.storageFake.keys()).toHaveLength(0);
  });

  it('answers STORAGE_FULL at the hard limit and allows exactly the limit', async () => {
    const v = variantsFor(2000, 1500);
    const need = sumBytes(v);
    const exact = await ready({ limits: { quotaHardBytes: need } });
    const ok = await exact.reserve(reserveRequest(id(1), 2000, 1500, v));
    expect(ok.items[0]!.ok).toBe(true);
    expect(ok.reserved_bytes).toBe(need);

    const tight = await ready({ limits: { quotaHardBytes: need - 1 } });
    const full = await tight.reserve(reserveRequest(id(1), 2000, 1500, v));
    expect(full.items[0]).toMatchObject({ ok: false, code: 'STORAGE_FULL' });
    expect(full.items[0]!.uploads).toBeUndefined();

    // a registered photo counts as used
    const two = await ready({ limits: { quotaHardBytes: need + need - 1 } });
    await addPhoto(two, id(1));
    expect((await two.storage()).used_bytes).toBe(need);
    const second = await two.reserve(reserveRequest(id(2), 2000, 1500, v));
    expect(second.items[0]).toMatchObject({ ok: false, code: 'STORAGE_FULL' });
  });

  it('answers FILE_TOO_LARGE per item and BATCH_TOO_LARGE per batch', async () => {
    const b = await ready({ limits: { maxUploadBytes: 5000, maxFilesPerBatch: 1 } });
    const big = variantsFor(2000, 1500, 6000);
    const r = await b.reserve(reserveRequest(id(1), 2000, 1500, big));
    expect(r.items[0]).toMatchObject({ ok: false, code: 'FILE_TOO_LARGE' });

    const small = variantsFor(2000, 1500);
    const two = reserveRequest(id(1), 2000, 1500, small);
    two.items.push({ ...two.items[0]!, photo_id: id(2) });
    expect(await codeOf(b.reserve(two))).toBe('BATCH_TOO_LARGE');
  });

  it('repeating a commit returns already_existed, also by legacy_key', async () => {
    const b = await ready();
    const first = await addPhoto(b, id(1), 2000, 1500, { legacy_key: 'weddings/a/1.jpg' });
    expect(first.already_existed).toBe(false);

    const v = variantsFor(2000, 1500);
    const again = await b.commit(commitRequest(id(1), 2000, 1500, v, { legacy_key: 'weddings/a/1.jpg' }));
    expect(again.already_existed).toBe(true);
    expect(again.photo.id).toBe(id(1));

    // another id for the same legacy key: the stored row wins, nothing is inserted
    const other = variantsFor(2000, 1500);
    const r = await b.reserve(reserveRequest(id(2), 2000, 1500, other));
    await putAll(b, r.items[0]!.uploads!);
    const dup = await b.commit(commitRequest(id(2), 2000, 1500, other, { legacy_key: 'weddings/a/1.jpg' }));
    expect(dup).toMatchObject({ already_existed: true });
    expect(dup.photo.id).toBe(id(1));
    expect(b.photos()).toHaveLength(1);
  });

  it('assigns sort max+10 in call order', async () => {
    const b = await ready();
    const a = await addPhoto(b, id(3));
    const c = await addPhoto(b, id(1));
    const d = await addPhoto(b, id(2));
    expect([a.photo.sort, c.photo.sort, d.photo.sort]).toEqual([10, 20, 30]);
  });

  it('commits legacy photos with variants of 720 for a master of 720 or more', async () => {
    const b = await ready();
    const r = await addPhoto(b, id(1), 964, 640);
    expect(r.photo.variants.webp.map((e) => e.tier)).toContain(720);
  });

  it('fails closed: unauthenticated before sign-in, NOT_ADMIN for an outsider', async () => {
    const raw = createFakeBackend();
    expect(await codeOf(raw.storage())).toBe('UNAUTHENTICATED');
    expect(await codeOf(raw.upsertCategory({ id: CAT, slug: 'x', name: 'X', sort: 10 }))).toBe('UNAUTHENTICATED');

    const outsider = createFakeBackend({ isAdmin: false });
    expect(await codeOf(outsider.signIn())).toBe('NOT_ADMIN');
    expect(await codeOf(outsider.upsertCategory({ id: CAT, slug: 'x', name: 'X', sort: 10 }))).toBe('UNAUTHENTICATED');
    expect(outsider.categories()).toHaveLength(0);
  });

  it('upsert returns the stored row untouched and never overwrites', async () => {
    const b = await ready();
    const again = await b.upsertAlbum({ id: id(9), category_id: CAT, slug: 'a2', title: 'Renamed', place: 'Brno', sort: 99, legacy_id: 'a', published: true });
    expect(again).toMatchObject({ id: ALBUM, title: 'A', sort: 10 });
    expect(b.albums()).toHaveLength(1);
    expect((await b.upsertCategory({ id: id(8), slug: 'weddings', name: 'Other', sort: 5 })).id).toBe(CAT);
  });

  it('sets a cover only from a photo of that album', async () => {
    const b = await ready();
    await addPhoto(b, id(1));
    await b.setCover(ALBUM, id(1));
    expect(b.albums()[0]!.cover_photo_id).toBe(id(1));
    expect(await codeOf(b.setCover(ALBUM, id(2)))).toBe('NOT_FOUND');
  });

  it('injects failures and records every call', async () => {
    const b = await ready();
    b.failNext('storage', 'network');
    expect(await codeOf(b.storage())).toBe('NETWORK');
    expect((await b.storage()).photo_count).toBe(0);
    b.failNext('put', 'server', 2);
    const v = variantsFor(2000, 1500);
    const r = await b.reserve(reserveRequest(id(1), 2000, 1500, v));
    const target = r.items[0]!.uploads![0]!;
    expect(await codeOf(b.put(target, new Uint8Array(1000)))).toBe('SERVER_ERROR');
    expect(await codeOf(b.put(target, new Uint8Array(1000)))).toBe('SERVER_ERROR');
    await b.put(target, new Uint8Array(1000));
    expect(b.calls.filter((c) => c === 'put')).toHaveLength(3);
  });

  it('rejects a PUT of the wrong size and an expired presign', async () => {
    const b = await ready();
    const v = variantsFor(2000, 1500);
    const r = await b.reserve(reserveRequest(id(1), 2000, 1500, v));
    const target = r.items[0]!.uploads![0]!;
    expect(await codeOf(b.put(target, new Uint8Array(999)))).toBe('PUT_REJECTED');
    b.advance(16 * 60_000);
    expect(await codeOf(b.put(target, new Uint8Array(1000)))).toBe('PRESIGN_EXPIRED');
    // re-reserve once gives fresh targets
    const again = await b.reserve(reserveRequest(id(1), 2000, 1500, v));
    await b.put(again.items[0]!.uploads![0]!, new Uint8Array(1000));
  });

  it('crash between PUT and commit leaves objects that a later commit adopts', async () => {
    const b = await ready();
    const v = variantsFor(2000, 1500);
    const r = await b.reserve(reserveRequest(id(1), 2000, 1500, v));
    await putAll(b, r.items[0]!.uploads!);
    b.failNext('commit', 'network');
    expect(await codeOf(b.commit(commitRequest(id(1), 2000, 1500, v)))).toBe('NETWORK');
    expect(b.photos()).toHaveLength(0);
    expect((await b.commit(commitRequest(id(1), 2000, 1500, v))).already_existed).toBe(false);
    expect(b.storageFake.keys()).toHaveLength(allKeys(id(1), v).length);
  });
});
