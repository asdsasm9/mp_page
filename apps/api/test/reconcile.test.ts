import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ReconcileResponseSchema,
  allKeys,
  createFakeStorage,
  variantPlan,
  type PhotoVariants,
} from '@mp/shared';
import { createReconcileRoute } from '../src/routes/reconcile';
import { makeWorld, type World } from './supabase-shim';

const CAT = 'aaaaaaaa-0000-4000-8000-000000000001';
const ALB = 'bbbbbbbb-0000-4000-8000-000000000001';
const id = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-19T12:00:00.000Z');
const HOURS = 3_600_000;

let world: World;
let stamp = NOW;
const storage = createFakeStorage({ baseUrl: 'https://img.test', now: () => stamp });

function variantsFor(bytes = 1000): PhotoVariants {
  const p = variantPlan(1200, 800);
  return {
    master: { w: p.master.w, h: p.master.h, bytes },
    webp: p.webp.map((e) => ({ tier: e.tier as 480, w: e.w, h: e.h, bytes })),
    jpeg: { w: p.jpeg.w, h: p.jpeg.h, bytes },
    og: { w: p.og.w, h: p.og.h, bytes },
  };
}
const KEYS_PER = allKeys(id(1), variantsFor()).length;
const PHOTO_BYTES = 1000 * KEYS_PER;

/** Put every file of photo n, written `ageMs` before NOW. */
async function putPhoto(n: number, ageMs = 0, bytes = 1000) {
  stamp = new Date(NOW.getTime() - ageMs);
  for (const k of allKeys(id(n), variantsFor())) await storage.put(k, new Uint8Array(bytes), { contentType: 'image/jpeg' });
  stamp = NOW;
}
async function insertRow(n: number) {
  await world.db.exec(`
    insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total)
    values ('${id(n)}', '${ALB}', 'photos/${id(n)}/master.jpg', 1200, 800,
            '${JSON.stringify(variantsFor())}'::jsonb, ${PHOTO_BYTES})`);
}

async function call(path: string, body: unknown, token: string | null = world.tokens.admin) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await world.app.fetch(
    new Request(`https://api.test${path}`, { method: 'POST', headers, body: JSON.stringify(body) }),
    world.env,
  );
  return { status: res.status, body: (await res.json()) as any };
}
const reconcile = (body: unknown = {}, token?: string | null) => call('/storage/reconcile', body, token);

beforeAll(async () => {
  world = await makeWorld({
    deps: {
      routes: {
        '/storage/reconcile': createReconcileRoute({ storage, now: () => NOW }),
        '/storage/reconcile-paged': createReconcileRoute({ storage, now: () => NOW, pageSize: 3, pageBudget: 2 }),
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

/** The planted scenario from the acceptance check. */
async function plant() {
  // 1: healthy. 2: a file missing. 3: a size mismatch.
  for (const n of [1, 2, 3]) {
    await putPhoto(n);
    await insertRow(n);
  }
  await storage.delete(allKeys(id(2), variantsFor())[1]!);
  await storage.put(allKeys(id(3), variantsFor())[0]!, new Uint8Array(999), { contentType: 'image/jpeg' });
  await putPhoto(10, 3 * HOURS); // old orphan
  await putPhoto(11, 10 * 60_000); // fresh orphan
  await putPhoto(12, 5 * HOURS); // old, but a live reservation owns it
  await world.db.exec(
    `insert into public.upload_reservations (photo_id, bytes, expires_at) values ('${id(12)}', ${PHOTO_BYTES}, '2099-01-01T00:00:00Z')`,
  );
  await storage.put('photos/not-a-uuid/x', new Uint8Array(4), { contentType: 'text/plain' });
  await storage.put('catalog/published.json', new Uint8Array(7), { contentType: 'application/json' });
}

describe('POST /storage/reconcile', () => {
  it('dry run reports exactly the drift and changes nothing', async () => {
    await plant();
    const before = storage.keys();
    const res = await reconcile();
    expect(res.status).toBe(200);
    expect(ReconcileResponseSchema.safeParse(res.body).success).toBe(true);
    const b = res.body;
    expect(b.applied).toBe(false);
    expect(b.deleted).toBe(0);
    expect(b.cursor).toBeUndefined();
    expect(b.orphans).toEqual([{ id: id(10), objects: KEYS_PER, bytes: PHOTO_BYTES }]);
    expect(b.missing).toEqual([{ id: id(2), keys: [allKeys(id(2), variantsFor())[1]] }]);
    expect(b.sizeMismatch).toEqual([
      { id: id(3), key: allKeys(id(3), variantsFor())[0], expected: 1000, actual: 999 },
    ]);
    expect(b.unknownKeys).toEqual(['photos/not-a-uuid/x']);
    expect(b.db).toEqual({ photos: 3, bytes: 3 * PHOTO_BYTES });
    // 3 photos (one file short, one 1 byte short) + 3 orphan/reserved photos + stray key; catalog is not under photos/.
    expect(b.r2.objects).toBe(6 * KEYS_PER - 1 + 1);
    expect(b.r2.bytes).toBe(6 * PHOTO_BYTES - 1000 - 1 + 4);
    expect(storage.keys()).toEqual(before);
  });

  it('apply deletes only the old orphan; fresh, reserved, live, stray and catalog keys stay', async () => {
    await plant();
    const before = storage.keys();
    const res = await reconcile({ apply: true });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(true);
    expect(res.body.deleted).toBe(KEYS_PER);
    expect(res.body.orphans).toHaveLength(1);
    const orphanKeys = new Set(allKeys(id(10), variantsFor()));
    expect(storage.keys()).toEqual(before.filter((k) => !orphanKeys.has(k)));
    expect(storage.keys()).toContain('catalog/published.json');
    expect(storage.keys()).toContain('photos/not-a-uuid/x');
    // Database rows are untouched.
    const n = await world.db.query<{ n: number }>('select count(*)::int as n from public.photos');
    expect(n.rows[0]!.n).toBe(3);
    // A second run finds nothing left to delete.
    const again = await reconcile({ apply: true });
    expect(again.body.orphans).toEqual([]);
    expect(again.body.deleted).toBe(0);
  });

  it('an orphan whose reservation has expired is deleted', async () => {
    await putPhoto(12, 5 * HOURS);
    await world.db.exec(
      `insert into public.upload_reservations (photo_id, bytes, expires_at) values ('${id(12)}', ${PHOTO_BYTES}, '2000-01-01T00:00:00Z')`,
    );
    const res = await reconcile({ apply: true });
    expect(res.body.deleted).toBe(KEYS_PER);
    expect(storage.keys()).toEqual([]);
  });

  it('a run over the page budget returns a cursor and the calls add up to the single-run report', async () => {
    await plant();
    const whole = (await reconcile()).body;

    const parts: any[] = [];
    let cursor: string | undefined;
    do {
      const r = await call('/storage/reconcile-paged', cursor === undefined ? {} : { cursor });
      expect(r.status).toBe(200);
      expect(ReconcileResponseSchema.safeParse(r.body).success).toBe(true);
      parts.push(r.body);
      cursor = r.body.cursor;
    } while (cursor !== undefined && parts.length < 50);

    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].cursor).toBeDefined();
    expect(parts.at(-1).cursor).toBeUndefined();
    const sum = (f: (p: any) => number) => parts.reduce((a, p) => a + f(p), 0);
    expect(sum((p) => p.r2.objects)).toBe(whole.r2.objects);
    expect(sum((p) => p.r2.bytes)).toBe(whole.r2.bytes);
    for (const p of parts) expect(p.db).toEqual(whole.db);
    expect(parts.flatMap((p) => p.orphans)).toEqual(whole.orphans);
    expect(parts.flatMap((p) => p.missing)).toEqual(whole.missing);
    expect(parts.flatMap((p) => p.sizeMismatch)).toEqual(whole.sizeMismatch);
    expect(parts.flatMap((p) => p.unknownKeys)).toEqual(whole.unknownKeys);
  });

  it('paged apply deletes the same orphan once and nothing else', async () => {
    await plant();
    let cursor: string | undefined;
    let deleted = 0;
    let guard = 0;
    do {
      const r = await call('/storage/reconcile-paged', { apply: true, ...(cursor ? { cursor } : {}) });
      deleted += r.body.deleted;
      cursor = r.body.cursor;
    } while (cursor !== undefined && ++guard < 50);
    expect(deleted).toBe(KEYS_PER);
    expect(storage.keys().filter((k) => k.startsWith(`photos/${id(10)}/`))).toEqual([]);
    expect(storage.keys().filter((k) => k.startsWith(`photos/${id(11)}/`))).toHaveLength(KEYS_PER);
    expect(storage.keys().filter((k) => k.startsWith(`photos/${id(12)}/`))).toHaveLength(KEYS_PER);
  });

  it('rejects a garbage cursor, unknown fields and non-admin or anonymous callers', async () => {
    await plant();
    const before = storage.keys();
    expect((await reconcile({ cursor: '%%%' })).body.error).toBe('INVALID_REQUEST');
    expect((await reconcile({ apply: 'yes' })).status).toBe(400);
    expect((await reconcile({ extra: 1 })).status).toBe(400);
    expect((await reconcile({ apply: true }, world.tokens.nonAdmin)).status).toBe(403);
    expect((await reconcile({ apply: true }, null)).status).toBe(401);
    expect(storage.keys()).toEqual(before);
  });

  it('a storage list failure is UPSTREAM_ERROR without deleting anything', async () => {
    const failing = createReconcileRoute({
      storage: {
        ...storage,
        list: async () => {
          throw new Error('boom');
        },
      },
      now: () => NOW,
    });
    const w = await makeWorld({ deps: { routes: { '/storage/reconcile': failing } } });
    try {
      const res = await w.app.fetch(
        new Request('https://api.test/storage/reconcile', {
          method: 'POST',
          headers: { authorization: `Bearer ${w.tokens.admin}`, 'content-type': 'application/json' },
          body: '{"apply":true}',
        }),
        w.env,
      );
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'UPSTREAM_ERROR' });
    } finally {
      await w.close();
    }
  });
});
