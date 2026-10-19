import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CommitResponseSchema,
  DeleteResponseSchema,
  allKeys,
  createFakeStorage,
  photoPrefix,
  planUploadFiles,
  variantPlan,
  type PhotoVariants,
} from '@mp/shared';
import { createCommitRoute } from '../src/routes/commit';
import { createDeleteRoute } from '../src/routes/delete';
import { createReserveRoute } from '../src/routes/reserve';
import { storageRoute } from '../src/routes/storage';
import { asRole } from '../../../supabase/tests/helpers/db';
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

function variantsFor(bytes = 1000): PhotoVariants {
  const p = variantPlan(W, H);
  return {
    master: { w: p.master.w, h: p.master.h, bytes },
    webp: p.webp.map((e) => ({ tier: e.tier as 480, w: e.w, h: e.h, bytes })),
    jpeg: { w: p.jpeg.w, h: p.jpeg.h, bytes },
    og: { w: p.og.w, h: p.og.h, bytes },
  };
}
const sum = (v: PhotoVariants) => v.master.bytes + v.webp.reduce((a, e) => a + e.bytes, 0) + v.jpeg.bytes + v.og.bytes;
const commitBody = (n: number, extra: Record<string, unknown> = {}, v = variantsFor()) => ({
  photo_id: id(n),
  album_id: ALB,
  width: W,
  height: H,
  variants: v,
  bytes_total: sum(v),
  ...extra,
});
/** Put every file of a photo into the fake bucket with the sizes in `v`. */
async function putAll(n: number, v = variantsFor()) {
  const sizes = [v.master.bytes, ...v.webp.map((e) => e.bytes), v.jpeg.bytes, v.og.bytes];
  const keys = allKeys(id(n), v);
  for (const [i, k] of keys.entries()) await storage.put(k, new Uint8Array(sizes[i]!), { contentType: 'image/jpeg' });
}
const listed = async (n: number) => (await storage.list(photoPrefix(id(n)))).objects.map((o) => o.key);

async function api(path: string, token: string | null, body: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await world.app.fetch(
    new Request(`https://api.test${path}`, { method: 'POST', headers, body: JSON.stringify(body) }),
    world.env,
  );
  return { status: res.status, body: (await res.json()) as any };
}
const commit = (body: unknown, token: string | null = world.tokens.admin) => api('/uploads/commit', token, body);
const del = (ids: string[], token: string | null = world.tokens.admin) => api('/photos/delete', token, { ids });
const reserve = (body: unknown) => api('/uploads/reserve', world.tokens.admin, body);
const usage = async () => {
  const res = await world.app.fetch(
    new Request('https://api.test/storage', { headers: { authorization: `Bearer ${world.tokens.admin}` } }),
    world.env,
  );
  return (await res.json()) as any;
};
const photoCount = async () =>
  Number((await world.db.query<{ n: number }>('select count(*)::int as n from public.photos')).rows[0]!.n);
const setLimits = (hard: number, warn: number) =>
  world.db.exec(`update public.app_config set quota_hard_bytes = ${hard}, quota_warn_bytes = ${warn}`);

beforeAll(async () => {
  world = await makeWorld({
    deps: {
      routes: {
        '/storage': storageRoute,
        '/uploads/reserve': createReserveRoute({ storage }),
        '/uploads/commit': createCommitRoute({ storage }),
        '/photos/delete': createDeleteRoute({ storage }),
      },
    },
  });
  await world.db.exec(`
    insert into public.categories (id, slug, name) values ('${CAT}', 'svatby', 'Svatby');
    insert into public.albums (id, category_id, slug, title) values ('${ALB}', '${CAT}', 'one', 'One');
  `);
});
afterAll(() => world.close());
beforeEach(async () => {
  vi.restoreAllMocks();
  await world.db.exec('update public.albums set cover_photo_id = null');
  await world.db.exec('delete from public.upload_reservations');
  await world.db.exec('delete from public.photos');
  await setLimits(9_500_000_000, 8_000_000_000);
  for (let n = 0; n < 12; n++) await storage.delete((await listed(n)));
});

describe('POST /uploads/commit', () => {
  it('happy path: reserve, simulatePut every file, commit; usage grows and the reservation is gone', async () => {
    const v = variantsFor();
    const planned = planUploadFiles(id(1), W, H);
    const res = await reserve({
      album_id: ALB,
      items: [
        {
          photo_id: id(1),
          width: W,
          height: H,
          files: planned.map((f) => ({ kind: f.kind, ...(f.tier ? { tier: f.tier } : {}), bytes: 1000 })),
        },
      ],
    });
    expect(res.status).toBe(200);
    expect((await usage()).reserved_bytes).toBe(sum(v));
    for (const t of res.body.items[0].uploads) await storage.simulatePut(t, new Uint8Array(1000));

    const out = await commit(commitBody(1));
    expect(out.status).toBe(200);
    expect(CommitResponseSchema.safeParse(out.body).success).toBe(true);
    expect(out.body.already_existed).toBe(false);
    expect(out.body.photo.bytes_total).toBe(sum(v));
    const u = await usage();
    expect(u.used_bytes).toBe(sum(v));
    expect(u.reserved_bytes).toBe(0);
  });

  it('a second identical commit returns already_existed and changes nothing', async () => {
    await putAll(1);
    expect((await commit(commitBody(1))).body.already_existed).toBe(false);
    const before = await usage();
    const again = await commit(commitBody(1));
    expect(again.status).toBe(200);
    expect(again.body.already_existed).toBe(true);
    expect(await usage()).toEqual(before);
    expect(await photoCount()).toBe(1);
  });

  it('a missing object, a wrong-size object, a sum mismatch and an oversize object are KEY_MISMATCH and leave nothing', async () => {
    const v = variantsFor();
    const keys = allKeys(id(1), v);

    await putAll(1);
    await storage.delete(keys[1]!);
    expect(await commit(commitBody(1))).toMatchObject({ status: 422, body: { error: 'KEY_MISMATCH' } });
    expect(await listed(1)).toEqual([]);

    await putAll(1);
    await storage.put(keys[0]!, new Uint8Array(999), { contentType: 'image/jpeg' });
    expect((await commit(commitBody(1))).body.error).toBe('KEY_MISMATCH');
    expect(await listed(1)).toEqual([]);

    await putAll(1);
    const bad = commitBody(1);
    bad.bytes_total += 1;
    expect((await commit(bad)).body.error).toBe('KEY_MISMATCH');
    expect(await listed(1)).toEqual([]);

    // Over the per-file limit (41_943_040): the declared size matches but exceeds max_upload_bytes.
    const big = variantsFor();
    big.master.bytes = 41_943_041;
    await putAll(1, big);
    expect((await commit(commitBody(1, {}, big))).body.error).toBe('KEY_MISMATCH');
    expect(await listed(1)).toEqual([]);
    expect(await photoCount()).toBe(0);
  });

  it('objects larger than the reservation are refused and removed', async () => {
    const small = variantsFor(100);
    const planned = planUploadFiles(id(1), W, H);
    await reserve({
      album_id: ALB,
      items: [
        {
          photo_id: id(1),
          width: W,
          height: H,
          files: planned.map((f) => ({ kind: f.kind, ...(f.tier ? { tier: f.tier } : {}), bytes: 100 })),
        },
      ],
    });
    expect(sum(small)).toBeLessThan(sum(variantsFor()));
    await putAll(1); // 1000-byte files although 100 were declared and reserved
    expect((await commit(commitBody(1))).body.error).toBe('KEY_MISMATCH');
    expect(await listed(1)).toEqual([]);
    expect(await photoCount()).toBe(0);
  });

  it('STORAGE_FULL at commit deletes the objects and returns the code', async () => {
    await putAll(1);
    await setLimits(sum(variantsFor()) - 1, 10);
    expect(await commit(commitBody(1))).toMatchObject({ status: 409, body: { error: 'STORAGE_FULL' } });
    expect(await listed(1)).toEqual([]);
    expect(await photoCount()).toBe(0);
  });

  it('ALBUM_NOT_FOUND cleans up, and a direct register_photo can skip HEAD but not the quota (D-7)', async () => {
    await putAll(1);
    const res = await commit({ ...commitBody(1), album_id: MISSING_ALB });
    expect(res).toMatchObject({ status: 404, body: { error: 'ALBUM_NOT_FOUND' } });
    expect(await listed(1)).toEqual([]);

    await setLimits(10, 5);
    const direct = await asRole(
      world.db,
      'authenticated',
      (d) =>
        d.query(
          `select public.register_photo('${id(2)}', '${ALB}', ${W}, ${H}, $1::jsonb, ${sum(variantsFor())}) as r`,
          [JSON.stringify(variantsFor())],
        ),
      ADMIN_USER,
    ).then(
      () => 'accepted',
      (e: Error) => e.message,
    );
    expect(direct).toContain('STORAGE_FULL');
    expect(await photoCount()).toBe(0);
  });

  it('CONFLICT deletes nothing', async () => {
    await putAll(1);
    expect((await commit(commitBody(1))).status).toBe(200);
    const other = variantsFor(2000);
    const res = await commit(commitBody(1, {}, other));
    // Different sizes: the HEAD check fails first and must not remove the live photo's objects.
    expect(res.status).toBe(422);
    expect(await listed(1)).toHaveLength(allKeys(id(1), variantsFor()).length);
    // Same bytes, different album: CONFLICT from the database, objects kept.
    const ALB2 = 'bbbbbbbb-0000-4000-8000-000000000002';
    await world.db.exec(`insert into public.albums (id, category_id, slug, title) values ('${ALB2}', '${CAT}', 'two', 'Two')`);
    const conflict = await commit({ ...commitBody(1), album_id: ALB2 });
    expect(conflict).toMatchObject({ status: 409, body: { error: 'CONFLICT' } });
    expect(await listed(1)).toHaveLength(allKeys(id(1), variantsFor()).length);
    await world.db.exec(`delete from public.albums where id = '${ALB2}'`);
  });

  it('rejects variants that do not match the plan, a camera-style alt and a bad legacy_key with 400', async () => {
    const odd = variantsFor();
    odd.webp = odd.webp.slice(1);
    expect((await commit(commitBody(1, {}, odd))).status).toBe(400);
    expect((await commit(commitBody(1, { alt: 'IMG_001.jpg' }))).status).toBe(400);
    expect((await commit(commitBody(1, { legacy_key: '../etc/passwd' }))).status).toBe(400);
    expect((await commit(commitBody(1, { legacy_key: 'weddings/a/1.png' }))).status).toBe(400);
  });

  it('a valid legacy_key is stored and makes a rerun with another id idempotent', async () => {
    await putAll(1);
    await putAll(2);
    const first = await commit(commitBody(1, { legacy_key: 'weddings/anna_petr/12.jpg' }));
    expect(first.status).toBe(200);
    expect(first.body.photo.legacy_key).toBe('weddings/anna_petr/12.jpg');
    const rerun = await commit(commitBody(2, { legacy_key: 'weddings/anna_petr/12.jpg' }));
    expect(rerun.status).toBe(200);
    expect(rerun.body.already_existed).toBe(true);
    expect(rerun.body.photo.id).toBe(id(1));
    expect(await photoCount()).toBe(1);
  });

  it('refuses a non-admin and an anonymous caller', async () => {
    await putAll(1);
    expect((await commit(commitBody(1), world.tokens.nonAdmin)).status).toBe(403);
    expect((await commit(commitBody(1), null)).status).toBe(401);
    expect(await photoCount()).toBe(0);
  });
});

describe('POST /photos/delete', () => {
  async function seed(n: number) {
    await putAll(n);
    expect((await commit(commitBody(n))).status).toBe(200);
  }

  it('deletes 3 photos: rows, usage, cover, every object including an orphan', async () => {
    for (const n of [1, 2, 3]) await seed(n);
    await storage.put(`${photoPrefix(id(2))}orphan.bin`, new Uint8Array(5), { contentType: 'application/octet-stream' });
    await world.db.exec(`update public.albums set cover_photo_id = '${id(2)}' where id = '${ALB}'`);
    const per = sum(variantsFor());
    expect((await usage()).used_bytes).toBe(3 * per);

    const res = await del([id(1), id(2), id(3)]);
    expect(res.status).toBe(200);
    expect(DeleteResponseSchema.safeParse(res.body).success).toBe(true);
    const keysPer = allKeys(id(1), variantsFor()).length;
    expect(res.body).toEqual({ deleted: 3, objectsDeleted: 3 * keysPer + 1, failed: [], publishRecommended: true });
    expect(await photoCount()).toBe(0);
    expect((await usage()).used_bytes).toBe(0);
    const cover = await world.db.query<{ c: string | null }>(`select cover_photo_id as c from public.albums where id = '${ALB}'`);
    expect(cover.rows[0]!.c).toBeNull();
    for (const n of [1, 2, 3]) expect(await listed(n)).toEqual([]);
  });

  it('an unknown id is a no-op', async () => {
    await seed(1);
    const res = await del([id(9)]);
    expect(res.body).toEqual({ deleted: 0, objectsDeleted: 0, failed: [], publishRecommended: true });
    expect(await photoCount()).toBe(1);
  });

  it('201 ids is 413 BATCH_TOO_LARGE', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => id(i + 1));
    expect(await del(ids)).toMatchObject({ status: 413, body: { error: 'BATCH_TOO_LARGE' } });
  });

  it('a storage error for one id lists it in failed while the others succeed', async () => {
    for (const n of [1, 2, 3]) await seed(n);
    const realList = storage.list.bind(storage);
    vi.spyOn(storage, 'list').mockImplementation(async (prefix, opts) => {
      if (prefix === photoPrefix(id(2))) throw new Error('boom');
      return realList(prefix, opts);
    });
    const res = await del([id(1), id(2), id(3)]);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(3);
    expect(res.body.failed).toEqual([id(2)]);
    expect(await photoCount()).toBe(0);
    vi.restoreAllMocks();
    expect(await listed(1)).toEqual([]);
    expect(await listed(2)).not.toEqual([]);
    expect(await listed(3)).toEqual([]);
  });

  it('refuses a non-admin and deletes nothing', async () => {
    await seed(1);
    expect((await del([id(1)], world.tokens.nonAdmin)).status).toBe(403);
    expect(await photoCount()).toBe(1);
    expect(await listed(1)).not.toEqual([]);
  });
});
