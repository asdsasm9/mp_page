// T-6 acceptance suite (WP4-18). The case titles are fixed: scripts/gates.mjs (quota-guard-tests)
// fails when one is renamed or removed. Everything is enforced server side: the endpoints are called
// directly, with no browser pre-check. Limits are configuration (app_config), never constants.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { allKeys, createFakeStorage, planUploadFiles, variantPlan, type PhotoVariants } from '@mp/shared';
import { asRole } from '../../../supabase/tests/helpers/db';
import { createCommitRoute } from '../src/routes/commit';
import { createDeleteRoute } from '../src/routes/delete';
import { createReserveRoute } from '../src/routes/reserve';
import { storageRoute } from '../src/routes/storage';
import { ADMIN_USER, makeWorld, type World } from './supabase-shim';

const CAT = 'aaaaaaaa-0000-4000-8000-000000000001';
const ALB = 'bbbbbbbb-0000-4000-8000-000000000001';
const id = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-19T12:00:00.000Z');
const W = 1200;
const H = 800;

let world: World;
// The bucket does not enforce the signed content-length (the case-8 mitigation scenario).
const storage = createFakeStorage({ baseUrl: 'https://img.test', now: () => NOW, enforceContentLength: false });

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
const PER = sum(variantsFor());
const item = (n: number, bytes = 1000) => ({
  photo_id: id(n),
  width: W,
  height: H,
  files: planUploadFiles(id(n), W, H).map((f) => ({ kind: f.kind, ...(f.tier ? { tier: f.tier } : {}), bytes })),
});
const commitBody = (n: number, v = variantsFor()) => ({
  photo_id: id(n),
  album_id: ALB,
  width: W,
  height: H,
  variants: v,
  bytes_total: sum(v),
});
async function putAll(n: number, v = variantsFor()) {
  const sizes = [v.master.bytes, ...v.webp.map((e) => e.bytes), v.jpeg.bytes, v.og.bytes];
  for (const [i, k] of allKeys(id(n), v).entries()) {
    await storage.put(k, new Uint8Array(sizes[i]!), { contentType: 'image/jpeg' });
  }
}

async function api(path: string, body?: unknown) {
  const res = await world.app.fetch(
    new Request(`https://api.test${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${world.tokens.admin}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    world.env,
  );
  return { status: res.status, body: (await res.json()) as any };
}
const reserve = (n: number, bytes = 1000) => api('/uploads/reserve', { album_id: ALB, items: [item(n, bytes)] });
const commit = (n: number) => api('/uploads/commit', commitBody(n));
const usage = async () => (await api('/storage')).body;
const setLimits = (hard: number, warn: number) =>
  world.db.exec(`update public.app_config set quota_hard_bytes = ${hard}, quota_warn_bytes = ${warn}`);
const photoCount = async () =>
  Number((await world.db.query<{ n: number }>('select count(*)::int as n from public.photos')).rows[0]!.n);
async function seed(n: number) {
  await putAll(n);
  expect((await commit(n)).status).toBe(200);
}

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
  await world.db.exec('update public.albums set cover_photo_id = null');
  await world.db.exec('delete from public.upload_reservations');
  await world.db.exec('delete from public.photos');
  await setLimits(9_500_000_000, 8_000_000_000);
  await storage.delete(storage.keys());
});

describe('T-6 quota guard acceptance', () => {
  it('refuses a reserve that would cross the hard limit and issues no URL', async () => {
    await setLimits(PER - 1, 10);
    const res = await reserve(1);
    expect(res.status).toBe(409);
    expect(res.body.items[0]).toEqual({ photo_id: id(1), ok: false, code: 'STORAGE_FULL' });
    expect(res.body.items[0].uploads).toBeUndefined();
    expect((await usage()).reserved_bytes).toBe(0);
  });

  it('accepts a reserve exactly at the limit', async () => {
    await setLimits(PER, 10);
    const res = await reserve(1);
    expect(res.status).toBe(200);
    expect(res.body.items[0].ok).toBe(true);
  });

  it('accepts just under the limit', async () => {
    await setLimits(PER + 1, 10);
    expect((await reserve(1)).status).toBe(200);
  });

  it('level is warn from the warn threshold and full at the hard limit', async () => {
    await seed(1);
    await setLimits(PER + 10, PER + 1);
    expect((await usage()).level).toBe('ok');
    await setLimits(PER + 10, PER);
    expect((await usage()).level).toBe('warn');
    await setLimits(PER, PER - 5);
    expect((await usage()).level).toBe('full');
  });

  it('deleting photos lowers usage and re-allows an upload', async () => {
    await seed(1);
    await setLimits(PER, PER - 5);
    expect((await reserve(2)).status).toBe(409);
    const del = await api('/photos/delete', { ids: [id(1)] });
    expect(del.status).toBe(200);
    expect((await usage()).used_bytes).toBe(0);
    expect((await reserve(2)).status).toBe(200);
  });

  it('a direct call over the limit is refused with STORAGE_FULL', async () => {
    await setLimits(100, 50);
    const res = await reserve(1);
    expect(res.status).toBe(409);
    expect(res.body.items[0].code).toBe('STORAGE_FULL');
    expect(await photoCount()).toBe(0);
  });

  it('limits come from app_config: lowering the limit changes the result', async () => {
    expect((await reserve(1)).status).toBe(200);
    await setLimits(100, 50);
    expect((await reserve(2)).status).toBe(409);
    await setLimits(9_500_000_000, 8_000_000_000);
    expect((await reserve(2)).status).toBe(200);
    const u = await usage();
    expect(u.hard).toBe(9_500_000_000);
    expect(u.warn).toBe(8_000_000_000);
  });

  it('commit is refused when the object is larger than reserved (presign did not enforce length)', async () => {
    const res = await reserve(1, 100);
    expect(res.status).toBe(200);
    // The bucket accepts a larger body than the signed content-length.
    const first = res.body.items[0].uploads[0];
    await expect(storage.simulatePut(first, new Uint8Array(5000))).resolves.toBeDefined();
    await putAll(1); // 1000-byte files although 100 were reserved
    const out = await commit(1);
    expect(out.body.error).toBe('KEY_MISMATCH');
    expect(await photoCount()).toBe(0);
    expect(storage.keys()).toEqual([]);
  });

  it('register backstop refuses over the limit even without a reservation', async () => {
    await setLimits(10, 5);
    const attempt = await asRole(
      world.db,
      'authenticated',
      (d) =>
        d.query(`select public.register_photo('${id(1)}', '${ALB}', ${W}, ${H}, $1::jsonb, ${PER}) as r`, [
          JSON.stringify(variantsFor()),
        ]),
      ADMIN_USER,
    ).then(
      () => 'accepted',
      (e: Error) => e.message,
    );
    expect(attempt).toContain('STORAGE_FULL');
    expect(await photoCount()).toBe(0);
  });

  it('partial batch: a refused big file does not block a later small one', async () => {
    await setLimits(PER + 10, 10);
    const res = await api('/uploads/reserve', { album_id: ALB, items: [item(1, 5000), item(2, 1000)] });
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.ok)).toEqual([false, true]);
  });

  it('two parallel batches cannot both take the last bytes', async () => {
    await setLimits(PER, 10);
    const a = await reserve(1);
    const b = await reserve(2);
    expect([a.status, b.status]).toEqual([200, 409]);
    expect((await usage()).reserved_bytes).toBe(PER);
  });
});

// WP-10 (T-270): the new quality makes a photo about 3.3 MB and a master up to its 5 MB cap.
// The server quota math needs no change; these cases prove it.
describe('WP-10 photo sizes against the server quota', () => {
  const sizedItem = (n: number, masterBytes: number, otherBytes: number) => ({
    photo_id: id(n),
    width: W,
    height: H,
    files: planUploadFiles(id(n), W, H).map((f) => ({
      kind: f.kind,
      ...(f.tier ? { tier: f.tier } : {}),
      bytes: f.kind === 'master' ? masterBytes : otherBytes,
    })),
  });
  const fileCount = planUploadFiles(id(1), W, H).length;
  const reserveSized = (n: number, masterBytes: number, otherBytes: number) =>
    api('/uploads/reserve', { album_id: ALB, items: [sizedItem(n, masterBytes, otherBytes)] });

  it('accepts a 3.3 MB photo and counts every byte', async () => {
    const other = Math.round((3_300_000 - 2_000_000) / (fileCount - 1));
    const total = 2_000_000 + other * (fileCount - 1);
    const res = await reserveSized(1, 2_000_000, other);
    expect(res.status).toBe(200);
    expect(res.body.items[0].ok).toBe(true);
    expect((await usage()).reserved_bytes).toBe(total);
  });

  it('accepts a 5 MB master (below the per-file limit) and refuses the photo one byte over the hard limit', async () => {
    const other = 300_000;
    const total = 5_000_000 + other * (fileCount - 1);
    await setLimits(total, 10);
    expect((await reserveSized(1, 5_000_000, other)).status).toBe(200);
    await storage.delete(storage.keys());
    await world.db.exec('delete from public.upload_reservations');
    await setLimits(total - 1, 10);
    const res = await reserveSized(2, 5_000_000, other);
    expect(res.status).toBe(409);
    expect(res.body.items[0].code).toBe('STORAGE_FULL');
  });
});
