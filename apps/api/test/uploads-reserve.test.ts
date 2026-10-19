import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeStorage, planUploadFiles, ReserveResponseSchema, StorageResponseSchema } from '@mp/shared';
import { asRole } from '../../../supabase/tests/helpers/db';
import { createReserveRoute } from '../src/routes/reserve';
import { storageRoute } from '../src/routes/storage';
import { ADMIN_USER, makeWorld, type World } from './supabase-shim';

const CAT = 'aaaaaaaa-0000-4000-8000-000000000001';
const ALB = 'bbbbbbbb-0000-4000-8000-000000000001';
const MISSING_ALB = 'bbbbbbbb-0000-4000-8000-0000000000ff';
const id = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-19T12:00:00.000Z');
const W = 1200;
const H = 800;

let world: World;
const storage = createFakeStorage({ baseUrl: 'https://img.test', now: () => NOW });
const presign = vi.spyOn(storage, 'presignPut');

function filesFor(photoId: string, bytes = 1000) {
  return planUploadFiles(photoId, W, H).map((f) => ({ kind: f.kind, ...(f.tier ? { tier: f.tier } : {}), bytes }));
}
const item = (n: number, bytes = 1000) => ({ photo_id: id(n), width: W, height: H, files: filesFor(id(n), bytes) });
const perItem = (bytes = 1000) => planUploadFiles(id(0), W, H).length * bytes;

async function api(path: string, token: string | null, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await world.app.fetch(
    new Request(`https://api.test${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    world.env,
  );
  return { status: res.status, body: (await res.json()) as any };
}
const reserve = (body: unknown, token: string | null = world.tokens.admin) => api('/uploads/reserve', token, body);
const storageUsage = () => api('/storage', world.tokens.admin);
const setLimits = (hard: number, warn: number) =>
  world.db.exec(`update public.app_config set quota_hard_bytes = ${hard}, quota_warn_bytes = ${warn}`);
const resetLimits = () => setLimits(9_500_000_000, 8_000_000_000);

beforeAll(async () => {
  world = await makeWorld({
    deps: { routes: { '/storage': storageRoute, '/uploads/reserve': createReserveRoute({ storage }) } },
  });
  await world.db.exec(`
    insert into public.categories (id, slug, name) values ('${CAT}', 'svatby', 'Svatby');
    insert into public.albums (id, category_id, slug, title) values ('${ALB}', '${CAT}', 'one', 'One');
  `);
});
afterAll(() => world.close());
beforeEach(async () => {
  presign.mockClear();
  await world.db.exec('delete from public.upload_reservations');
  await world.db.exec('delete from public.photos');
  await resetLimits();
});

describe('GET /storage', () => {
  it('returns exactly what storage_usage returns', async () => {
    const res = await storageUsage();
    const direct = await asRole(
      world.db,
      'authenticated',
      (d) => d.query<{ u: unknown }>('select public.storage_usage() as u'),
      ADMIN_USER,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual(direct.rows[0]!.u);
    expect(StorageResponseSchema.safeParse(res.body).success).toBe(true);
  });

  it('refuses a non-admin with 403 and no token with 401', async () => {
    const non = await api('/storage', world.tokens.nonAdmin);
    expect(non).toMatchObject({ status: 403, body: { error: 'NOT_ADMIN' } });
    const anon = await api('/storage', null);
    expect(anon).toMatchObject({ status: 401, body: { error: 'UNAUTHENTICATED' } });
  });

  it('reserved_bytes changes after a reservation', async () => {
    expect((await storageUsage()).body.reserved_bytes).toBe(0);
    await reserve({ album_id: ALB, items: [item(1)] });
    expect((await storageUsage()).body.reserved_bytes).toBe(perItem());
  });
});

describe('POST /uploads/reserve', () => {
  it('signs every file of 3 valid items: exact size, shared-helper key, 15 minute expiry', async () => {
    const items = [item(1), item(2, 2000), item(3, 3000)];
    const res = await reserve({ album_id: ALB, items });
    expect(res.status).toBe(200);
    expect(ReserveResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.items).toHaveLength(3);
    const expiry = new Date(NOW.getTime() + 15 * 60 * 1000).toISOString();
    for (const [i, r] of res.body.items.entries()) {
      expect(r.ok).toBe(true);
      const planned = planUploadFiles(items[i]!.photo_id, W, H);
      expect(r.uploads.map((u: any) => u.key)).toEqual(planned.map((p) => p.key));
      for (const u of r.uploads) {
        expect(u.method).toBe('PUT');
        expect(u.expiresAt).toBe(expiry);
        expect(u.headers['content-length']).toBe(String((i + 1) * 1000));
        expect(u.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      }
    }
    expect(res.body.reserved_bytes).toBe(perItem(1000) + perItem(2000) + perItem(3000));
    // The issued URL really accepts exactly the signed size.
    const target = res.body.items[0].uploads[0];
    await expect(storage.simulatePut(target, new Uint8Array(999))).rejects.toThrow();
    await storage.simulatePut(target, new Uint8Array(1000));
    await storage.delete(target.key);
  });

  it('refuses a non-admin and an unauthenticated caller before anything is signed', async () => {
    expect((await reserve({ album_id: ALB, items: [item(1)] }, world.tokens.nonAdmin)).status).toBe(403);
    expect((await reserve({ album_id: ALB, items: [item(1)] }, null)).status).toBe(401);
    expect(presign).not.toHaveBeenCalled();
  });

  it('rejects malformed requests with 400 and signs nothing', async () => {
    const good = item(1);
    const cases: Record<string, unknown> = {
      'missing file': { ...good, files: good.files.slice(1) },
      'extra kind': { ...good, files: [...good.files, { kind: 'webp', tier: 2400, bytes: 10 }] },
      'duplicate file': { ...good, files: [...good.files, good.files[0]] },
      'client key': { ...good, files: good.files.map((f) => ({ ...f, key: 'photos/x/master.jpg' })) },
      'key on item': { ...good, key: 'photos/x/master.jpg' },
      'bad id': { ...good, photo_id: 'NOT-A-UUID' },
      'too big edge': { ...good, width: 5000 },
    };
    for (const [name, bad] of Object.entries(cases)) {
      const res = await reserve({ album_id: ALB, items: [bad] });
      expect(res.status, name).toBe(400);
    }
    const dup = await reserve({ album_id: ALB, items: [item(1), item(1)] });
    expect(dup).toMatchObject({ status: 400, body: { error: 'INVALID_ITEMS' } });
    expect(presign).not.toHaveBeenCalled();
  });

  it('returns 409 CONFLICT for an existing photo id and issues nothing', async () => {
    await world.db.exec(
      `insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total)
       values ('${id(1)}', '${ALB}', 'photos/${id(1)}/master.jpg', 1, 1, '{}', 5)`,
    );
    const res = await reserve({ album_id: ALB, items: [item(2), item(1)] });
    expect(res).toMatchObject({ status: 409, body: { error: 'CONFLICT' } });
    expect(presign).not.toHaveBeenCalled();
    expect((await storageUsage()).body.reserved_bytes).toBe(0);
  });

  it('returns 404 ALBUM_NOT_FOUND for an unknown album', async () => {
    const res = await reserve({ album_id: MISSING_ALB, items: [item(1)] });
    expect(res).toMatchObject({ status: 404, body: { error: 'ALBUM_NOT_FOUND' } });
    expect(presign).not.toHaveBeenCalled();
  });

  it('returns 413 BATCH_TOO_LARGE for 201 items', async () => {
    const items = Array.from({ length: 201 }, (_, i) => item(i + 1));
    const res = await reserve({ album_id: ALB, items });
    expect(res).toMatchObject({ status: 413, body: { error: 'BATCH_TOO_LARGE' } });
    expect(presign).not.toHaveBeenCalled();
  });

  it('refuses an item with one file over max_upload_bytes, per item, and signs only the others', async () => {
    const big = item(1);
    big.files[0]!.bytes = 41_943_041;
    const res = await reserve({ album_id: ALB, items: [big, item(2)] });
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toEqual({ photo_id: id(1), ok: false, code: 'FILE_TOO_LARGE' });
    expect(res.body.items[1].ok).toBe(true);
    expect(presign).toHaveBeenCalledTimes(planUploadFiles(id(2), W, H).length);
    expect(res.body.reserved_bytes).toBe(perItem());

    const all = await reserve({ album_id: ALB, items: [big] });
    expect(all.status).toBe(409);
    expect(all.body.items[0].uploads).toBeUndefined();
  });

  it('reserving twice for the same id replaces the reservation', async () => {
    await reserve({ album_id: ALB, items: [item(1)] });
    const again = await reserve({ album_id: ALB, items: [item(1)] });
    expect(again.status).toBe(200);
    expect(again.body.reserved_bytes).toBe(perItem());
    expect((await storageUsage()).body.reserved_bytes).toBe(perItem());
  });
});

describe('quota guard (T-6, server side)', () => {
  it('refuses a reserve that would cross the hard limit and issues no URL', async () => {
    await setLimits(perItem() - 1, 10);
    const res = await reserve({ album_id: ALB, items: [item(1)] });
    expect(res.status).toBe(409);
    expect(res.body.items[0]).toEqual({ photo_id: id(1), ok: false, code: 'STORAGE_FULL' });
    expect(presign).not.toHaveBeenCalled();
    expect((await storageUsage()).body.reserved_bytes).toBe(0);
  });

  it('accepts a reserve exactly at the limit and just under it', async () => {
    await setLimits(perItem(), 10);
    expect((await reserve({ album_id: ALB, items: [item(1)] })).status).toBe(200);
    await world.db.exec('delete from public.upload_reservations');
    await setLimits(perItem() + 1, 10);
    expect((await reserve({ album_id: ALB, items: [item(1)] })).status).toBe(200);
  });

  it('a direct call over the limit is refused with STORAGE_FULL', async () => {
    await setLimits(100, 50);
    const res = await reserve({ album_id: ALB, items: [item(1), item(2)] });
    expect(res.status).toBe(409);
    expect(res.body.items.map((i: any) => i.code)).toEqual(['STORAGE_FULL', 'STORAGE_FULL']);
    expect(res.body.reserved_bytes).toBe(0);
  });

  it('partial batch: a refused big item does not block a later small one', async () => {
    await setLimits(perItem(1000) + 10, 10);
    const res = await reserve({ album_id: ALB, items: [item(1, 5000), item(2, 1000)] });
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.ok)).toEqual([false, true]);
  });

  it('limits come from app_config: lowering the limit changes the result', async () => {
    expect((await reserve({ album_id: ALB, items: [item(1)] })).status).toBe(200);
    await setLimits(100, 50);
    expect((await reserve({ album_id: ALB, items: [item(2)] })).status).toBe(409);
  });

  it('sequential batches cannot both take the last bytes', async () => {
    await setLimits(perItem(), 10);
    const a = await reserve({ album_id: ALB, items: [item(1)] });
    const b = await reserve({ album_id: ALB, items: [item(2)] });
    expect([a.status, b.status]).toEqual([200, 409]);
  });
});
