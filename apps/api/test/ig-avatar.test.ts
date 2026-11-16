import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IG_AVATAR_MAX_BYTES,
  IG_AVATAR_MAX_LIVE,
  IgAvatarCleanupResponseSchema,
  IgAvatarReserveResponseSchema,
  createFakeStorage,
  igAvatarKey,
  isValidIgAvatarKey,
} from '@mp/shared';
import { createIgAvatarCleanupRoute, createIgAvatarReserveRoute } from '../src/routes/ig-avatar';
import { makeWorld, type World } from './supabase-shim';

const NOW = new Date('2026-11-16T12:00:00.000Z');
const HOURS = 3_600_000;
const uid = (n: number) => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`;

let world: World;
let stamp = NOW;
const storage = createFakeStorage({ baseUrl: 'https://img.test', now: () => stamp });
const presign = vi.spyOn(storage, 'presignPut');

/** Put an avatar object written `ageMs` before NOW. */
async function putAvatar(n: number, ageMs = 0, bytes = 1000) {
  stamp = new Date(NOW.getTime() - ageMs);
  await storage.put(igAvatarKey(uid(n)), new Uint8Array(bytes), { contentType: 'image/webp' });
  stamp = NOW;
}
const setCurrent = (n: number | null) =>
  world.db.exec(`update public.ig_profile set avatar_key = ${n === null ? 'null' : `'${igAvatarKey(uid(n))}'`}`);
const avatarKeys = () => storage.keys().filter((k) => k.startsWith('ig/avatar/'));

async function call(path: string, token: string | null, body?: unknown, raw?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const init: RequestInit = { method: 'POST', headers };
  if (raw !== undefined) init.body = raw;
  else if (body !== undefined) init.body = JSON.stringify(body);
  const res = await world.app.fetch(new Request(`https://api.test${path}`, init), world.env);
  return { status: res.status, body: (await res.json()) as any };
}
const reserve = (body?: unknown, token: string | null = world.tokens.admin) => call('/ig/avatar/reserve', token, body);
const cleanup = (token: string | null = world.tokens.admin) => call('/ig/avatar/cleanup', token, {});

beforeAll(async () => {
  world = await makeWorld({
    deps: {
      routes: {
        '/ig/avatar/reserve': createIgAvatarReserveRoute({ storage, now: () => NOW }),
        '/ig/avatar/cleanup': createIgAvatarCleanupRoute({ storage, now: () => NOW }),
      },
    },
  });
});
afterAll(() => world.close());
beforeEach(async () => {
  presign.mockClear();
  stamp = NOW;
  await storage.delete(storage.keys());
  await setCurrent(null);
});

describe('POST /ig/avatar/reserve', () => {
  it('issues a worker-generated key and a signed 480 webp upload', async () => {
    const res = await reserve({ bytes: 5000 });
    expect(res.status).toBe(200);
    expect(IgAvatarReserveResponseSchema.safeParse(res.body).success).toBe(true);
    expect(isValidIgAvatarKey(res.body.key)).toBe(true);
    expect(res.body.upload.key).toBe(res.body.key);
    expect(res.body.upload.method).toBe('PUT');
    expect(res.body.upload.headers['content-type']).toBe('image/webp');
    expect(res.body.upload.headers['content-length']).toBe('5000');
    expect(res.body.upload.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.body.upload.expiresAt).toBe(new Date(NOW.getTime() + 15 * 60 * 1000).toISOString());
    expect(presign).toHaveBeenCalledTimes(1);
    // The grant really accepts exactly the signed size and nothing else.
    await expect(storage.simulatePut(res.body.upload, new Uint8Array(4999))).rejects.toThrow();
    await storage.simulatePut(res.body.upload, new Uint8Array(5000));
    expect(avatarKeys()).toEqual([res.body.key]);
  });

  it('accepts exactly the byte limit and refuses one byte more with 413 FILE_TOO_LARGE', async () => {
    expect((await reserve({ bytes: IG_AVATAR_MAX_BYTES })).status).toBe(200);
    presign.mockClear();
    expect(await reserve({ bytes: IG_AVATAR_MAX_BYTES + 1 })).toMatchObject({ status: 413, body: { error: 'FILE_TOO_LARGE' } });
    expect(presign).not.toHaveBeenCalled();
  });

  it('refuses zero, negative, non-integer, wrong type, missing and malformed bodies with 400', async () => {
    for (const body of [{ bytes: 0 }, { bytes: -1 }, { bytes: 1.5 }, { bytes: '5' }, {}, { bytes: null }]) {
      expect(await reserve(body), JSON.stringify(body)).toMatchObject({ status: 400, body: { error: 'INVALID_REQUEST' } });
    }
    expect(await reserve(undefined)).toMatchObject({ status: 400, body: { error: 'INVALID_REQUEST' } });
    expect(await call('/ig/avatar/reserve', world.tokens.admin, undefined, '{nope')).toMatchObject({
      status: 400,
      body: { error: 'INVALID_REQUEST' },
    });
    expect(presign).not.toHaveBeenCalled();
  });

  it('never uses a client-supplied key', async () => {
    const forged = igAvatarKey(uid(99));
    expect(await reserve({ bytes: 100, key: forged })).toMatchObject({ status: 400, body: { error: 'INVALID_REQUEST' } });
    expect(await reserve({ bytes: 100, key: 'photos/x/master.jpg' })).toMatchObject({ status: 400 });
    expect(presign).not.toHaveBeenCalled();
    const ok = await reserve({ bytes: 100 });
    expect(ok.body.key).not.toBe(forged);
  });

  it('refuses a non-admin with 403 and no token with 401, before anything is signed', async () => {
    expect(await reserve({ bytes: 100 }, world.tokens.nonAdmin)).toMatchObject({ status: 403, body: { error: 'NOT_ADMIN' } });
    expect(await reserve({ bytes: 100 }, null)).toMatchObject({ status: 401, body: { error: 'UNAUTHENTICATED' } });
    expect(presign).not.toHaveBeenCalled();
  });

  it('is full at the live cap when nothing can be cleaned (STORAGE_FULL), without signing', async () => {
    for (let i = 1; i <= IG_AVATAR_MAX_LIVE; i++) await putAvatar(i, 10 * 60_000);
    expect(await reserve({ bytes: 100 })).toMatchObject({ status: 409, body: { error: 'STORAGE_FULL' } });
    expect(presign).not.toHaveBeenCalled();
    expect(avatarKeys()).toHaveLength(IG_AVATAR_MAX_LIVE);
  });

  it('runs cleanup first at the cap and then succeeds, keeping the current key', async () => {
    for (let i = 1; i <= IG_AVATAR_MAX_LIVE; i++) await putAvatar(i, 3 * HOURS);
    await setCurrent(1);
    const res = await reserve({ bytes: 100 });
    expect(res.status).toBe(200);
    expect(avatarKeys()).toEqual([igAvatarKey(uid(1))]);
  });

  it('does not touch the bucket outside ig/avatar/', async () => {
    await storage.put('photos/x/master.jpg', new Uint8Array(10), { contentType: 'image/jpeg' });
    for (let i = 1; i <= IG_AVATAR_MAX_LIVE; i++) await putAvatar(i, 3 * HOURS);
    await setCurrent(null);
    expect((await reserve({ bytes: 100 })).status).toBe(200);
    expect(storage.keys()).toContain('photos/x/master.jpg');
  });
});

describe('POST /ig/avatar/cleanup', () => {
  it('keeps the current key and young objects, deletes old and oversized ones', async () => {
    await putAvatar(1, 5 * HOURS); // current, old: kept
    await putAvatar(2, 5 * HOURS); // old: deleted
    await putAvatar(3, 10 * 60_000); // young: kept
    await putAvatar(4, 10 * 60_000, IG_AVATAR_MAX_BYTES + 1); // young but oversized: deleted
    await putAvatar(5, 5 * HOURS, IG_AVATAR_MAX_BYTES + 1); // old and oversized: deleted
    await setCurrent(1);
    const res = await cleanup();
    expect(res.status).toBe(200);
    expect(IgAvatarCleanupResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body).toEqual({ deleted: 3 });
    expect(avatarKeys()).toEqual([igAvatarKey(uid(1)), igAvatarKey(uid(3))]);
  });

  it('keeps an oversized current key', async () => {
    await putAvatar(1, 5 * HOURS, IG_AVATAR_MAX_BYTES + 1);
    await setCurrent(1);
    expect((await cleanup()).body).toEqual({ deleted: 0 });
    expect(avatarKeys()).toHaveLength(1);
  });

  it('is idempotent', async () => {
    await putAvatar(1, 5 * HOURS);
    await putAvatar(2, 5 * HOURS);
    await setCurrent(2);
    expect((await cleanup()).body).toEqual({ deleted: 1 });
    expect((await cleanup()).body).toEqual({ deleted: 0 });
    expect(avatarKeys()).toEqual([igAvatarKey(uid(2))]);
  });

  it('with no avatar saved deletes only old objects and never touches other prefixes', async () => {
    await storage.put('photos/x/master.jpg', new Uint8Array(10), { contentType: 'image/jpeg' });
    await putAvatar(1, 5 * HOURS);
    await putAvatar(2, 1 * 60_000);
    expect((await cleanup()).body).toEqual({ deleted: 1 });
    expect(storage.keys()).toEqual([igAvatarKey(uid(2)), 'photos/x/master.jpg'].sort());
  });

  it('refuses a non-admin with 403 and no token with 401, deleting nothing', async () => {
    await putAvatar(1, 5 * HOURS);
    expect(await cleanup(world.tokens.nonAdmin)).toMatchObject({ status: 403, body: { error: 'NOT_ADMIN' } });
    expect(await cleanup(null)).toMatchObject({ status: 401, body: { error: 'UNAUTHENTICATED' } });
    expect(avatarKeys()).toHaveLength(1);
  });
});
