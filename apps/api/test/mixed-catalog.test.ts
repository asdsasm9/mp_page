import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ReconcileResponseSchema,
  SnapshotSchema,
  allKeys,
  assertPublishable,
  buildSnapshot,
  createFakeStorage,
  planUploadFiles,
  variantPlan,
  type PhotoVariants,
} from '@mp/shared';
import { createCommitRoute } from '../src/routes/commit';
import { createDeleteRoute } from '../src/routes/delete';
import { createReconcileRoute } from '../src/routes/reconcile';
import { createReserveRoute } from '../src/routes/reserve';
import { makeWorld, type World } from './supabase-shim';
import { syntheticCatalog } from './synthetic-catalog';

/**
 * WP-03b step 5: a catalog with photos that have the 720 WebP tier (new uploads) and photos without it
 * (rows stored before the tier existed). Legacy rows stay valid and are never re-validated.
 */
const CAT = 'aaaaaaaa-0000-4000-8000-000000000001';
const ALB = 'bbbbbbbb-0000-4000-8000-000000000001';
const id = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-19T12:00:00.000Z');
const W = 1200;
const H = 800;

let world: World;
const storage = createFakeStorage({ baseUrl: 'https://img.test', now: () => NOW });

function fullVariants(bytes = 1000): PhotoVariants {
  const p = variantPlan(W, H);
  return {
    master: { w: p.master.w, h: p.master.h, bytes },
    webp: p.webp.map((e) => ({ tier: e.tier as 480, w: e.w, h: e.h, bytes })),
    jpeg: { w: p.jpeg.w, h: p.jpeg.h, bytes },
    og: { w: p.og.w, h: p.og.h, bytes },
  };
}
/** The same photo as stored before the 720 tier existed. */
function legacyVariants(bytes = 1000): PhotoVariants {
  const v = fullVariants(bytes);
  return { ...v, webp: v.webp.filter((e) => e.tier !== 720) };
}
const sum = (v: PhotoVariants) => v.master.bytes + v.webp.reduce((a, e) => a + e.bytes, 0) + v.jpeg.bytes + v.og.bytes;
const commitBody = (n: number, v: PhotoVariants) => ({
  photo_id: id(n),
  album_id: ALB,
  width: W,
  height: H,
  variants: v,
  bytes_total: sum(v),
});
async function putAll(n: number, v: PhotoVariants) {
  const sizes = [v.master.bytes, ...v.webp.map((e) => e.bytes), v.jpeg.bytes, v.og.bytes];
  for (const [i, k] of allKeys(id(n), v).entries()) await storage.put(k, new Uint8Array(sizes[i]!), { contentType: 'image/jpeg' });
}
const listed = async (n: number) => (await storage.list(`photos/${id(n)}/`)).objects.map((o) => o.key);
async function insertRow(n: number, v: PhotoVariants) {
  await world.db.exec(`
    insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total)
    values ('${id(n)}', '${ALB}', 'photos/${id(n)}/master.jpg', ${W}, ${H}, '${JSON.stringify(v)}'::jsonb, ${sum(v)})`);
}

async function api(path: string, body: unknown) {
  const res = await world.app.fetch(
    new Request(`https://api.test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${world.tokens.admin}` },
      body: JSON.stringify(body),
    }),
    world.env,
  );
  return { status: res.status, body: (await res.json()) as any };
}
const reserve = (items: unknown[]) => api('/uploads/reserve', { album_id: ALB, items });
const filesOf = (n: number, bytes = 1000) =>
  planUploadFiles(id(n), W, H).map((f) => ({ kind: f.kind, ...(f.tier ? { tier: f.tier } : {}), bytes }));

beforeAll(async () => {
  world = await makeWorld({
    deps: {
      routes: {
        '/uploads/reserve': createReserveRoute({ storage }),
        '/uploads/commit': createCommitRoute({ storage }),
        '/photos/delete': createDeleteRoute({ storage }),
        '/storage/reconcile': createReconcileRoute({ storage, now: () => NOW }),
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
  await world.db.exec('delete from public.upload_reservations');
  await world.db.exec('delete from public.photos');
  await storage.delete(storage.keys());
});

describe('720 tier in the plan', () => {
  it('a 1200 px master plans 480, 720 and 960', () => {
    expect(variantPlan(W, H).webp.map((e) => e.tier)).toEqual([480, 720, 960]);
    expect(fullVariants().webp.map((e) => e.tier)).toEqual([480, 720, 960]);
    expect(legacyVariants().webp.map((e) => e.tier)).toEqual([480, 960]);
  });
});

describe('reserve and commit', () => {
  it('reserve accepts the full plan including 720 and signs a 720.webp key', async () => {
    const res = await reserve([{ photo_id: id(1), width: W, height: H, files: filesOf(1) }]);
    expect(res.status).toBe(200);
    expect(res.body.items[0].uploads.map((u: any) => u.key)).toContain(`photos/${id(1)}/720.webp`);
  });

  it('reserve refuses a missing 720 and an extra tier (800 and 2400)', async () => {
    const files = filesOf(1);
    const missing = files.filter((f: any) => f.tier !== 720);
    const extra800 = [...files, { kind: 'webp', tier: 800, bytes: 1000 }];
    const extra2400 = [...files, { kind: 'webp', tier: 2400, bytes: 1000 }];
    for (const bad of [missing, extra800, extra2400]) {
      const res = await reserve([{ photo_id: id(1), width: W, height: H, files: bad }]);
      expect(res.status).toBe(400);
    }
  });

  it('commit accepts a full 720 plan', async () => {
    const v = fullVariants();
    await putAll(1, v);
    const out = await api('/uploads/commit', commitBody(1, v));
    expect(out.status).toBe(200);
    expect(out.body.photo.variants.webp.map((e: any) => e.tier)).toEqual([480, 720, 960]);
  });

  it('commit refuses a new upload without 720, with an extra tier, and with an 800 tier', async () => {
    const legacy = legacyVariants();
    await putAll(1, legacy);
    expect((await api('/uploads/commit', commitBody(1, legacy))).status).toBe(400);

    const extra = fullVariants();
    extra.webp.push({ tier: 2400, w: 2400, h: 1600, bytes: 1000 });
    expect((await api('/uploads/commit', commitBody(2, extra))).status).toBe(400);

    const stray = fullVariants();
    stray.webp.push({ tier: 800 as 480, w: 800, h: 533, bytes: 1000 });
    expect((await api('/uploads/commit', commitBody(3, stray))).status).toBe(400);

    const rows = await world.db.query<{ n: number }>('select count(*)::int as n from public.photos');
    expect(rows.rows[0]!.n).toBe(0);
  });
});

describe('legacy rows without 720', () => {
  it('reconcile reports no drift for a legacy row and a new row side by side', async () => {
    const legacy = legacyVariants();
    const full = fullVariants();
    await putAll(1, legacy);
    await insertRow(1, legacy);
    await putAll(2, full);
    await insertRow(2, full);
    const res = await api('/storage/reconcile', {});
    expect(res.status).toBe(200);
    expect(ReconcileResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.missing).toEqual([]);
    expect(res.body.sizeMismatch).toEqual([]);
    expect(res.body.orphans).toEqual([]);
    expect(res.body.unknownKeys).toEqual([]);
    expect(res.body.db).toEqual({ photos: 2, bytes: sum(legacy) + sum(full) });
    expect(res.body.r2.objects).toBe(allKeys(id(1), legacy).length + allKeys(id(2), full).length);
  });

  it('delete removes exactly the keys in the variants of a legacy row and of a new row', async () => {
    const legacy = legacyVariants();
    const full = fullVariants();
    await putAll(1, legacy);
    await insertRow(1, legacy);
    await putAll(2, full);
    await insertRow(2, full);
    expect(await listed(1)).not.toContain(`photos/${id(1)}/720.webp`);
    const res = await api('/photos/delete', { ids: [id(1), id(2)] });
    expect(res.status).toBe(200);
    expect(res.body.objectsDeleted).toBe(allKeys(id(1), legacy).length + allKeys(id(2), full).length);
    expect(res.body.failed).toEqual([]);
    expect(await listed(1)).toEqual([]);
    expect(await listed(2)).toEqual([]);
  });
});

describe('buildSnapshot on a mixed catalog', () => {
  it('is publishable and keeps each photo with its own tier list', () => {
    const rows = syntheticCatalog({ photos: 6, albums: 2, categories: 1 });
    expect(rows.photos[0]!.variants.webp.map((e) => e.tier)).toContain(720);
    for (const i of [1, 3, 5]) {
      const p = rows.photos[i]!;
      const webp = p.variants.webp.filter((e) => e.tier !== 720);
      const variants = { ...p.variants, webp };
      rows.photos[i] = {
        ...p,
        variants,
        bytes_total: variants.master.bytes + webp.reduce((s, e) => s + e.bytes, 0) + variants.jpeg.bytes + variants.og.bytes,
      };
    }
    const snap = buildSnapshot(rows, NOW);
    expect(() => assertPublishable(snap)).not.toThrow();
    expect(SnapshotSchema.safeParse(JSON.parse(JSON.stringify(snap))).success).toBe(true);
    expect(snap.counts.photos).toBe(6);
    const photos = snap.categories.flatMap((c) => c.albums.flatMap((a) => a.photos));
    const withTier = photos.filter((p) => p.variants.webp.some((e) => e.tier === 720));
    const without = photos.filter((p) => !p.variants.webp.some((e) => e.tier === 720));
    expect(withTier).toHaveLength(3);
    expect(without).toHaveLength(3);
  });
});
