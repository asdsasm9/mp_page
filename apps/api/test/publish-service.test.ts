import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  SNAPSHOT_KEY,
  SnapshotSchema,
  backupKey,
  buildSnapshot,
  createFakeStorage,
  variantPlan,
  type PhotoVariants,
} from '@mp/shared';
import {
  BACKUPS_TO_KEEP,
  PublishServiceError,
  buildAndStoreSnapshot,
  loadCatalogRows,
  pruneBackups,
} from '../src/publish-service';
import { createSupabaseClient } from '../src/supabase';
import { SHIM_ANON_KEY, SHIM_SUPABASE_URL, makeWorld, type World } from './supabase-shim';

const CAT = 'aaaaaaaa-0000-4000-8000-000000000001';
const HIDDEN_CAT = 'aaaaaaaa-0000-4000-8000-000000000002';
const ALB_PUB = 'bbbbbbbb-0000-4000-8000-000000000001';
const ALB_DRAFT = 'bbbbbbbb-0000-4000-8000-000000000002';
const PHOTO = 'cccccccc-0000-4000-8000-000000000001';
const PHOTO_DRAFT = 'cccccccc-0000-4000-8000-000000000002';
const T0 = new Date('2026-10-19T12:00:00.000Z');

let world: World;
let clock = T0;
const publicBucket = createFakeStorage({ baseUrl: 'https://img.test' });
const backupBucket = createFakeStorage({ baseUrl: 'https://backup.invalid' });

const supabase = () =>
  createSupabaseClient({ supabaseUrl: SHIM_SUPABASE_URL, anonKey: SHIM_ANON_KEY, fetch: world.shim.fetch });
const deps = () => ({ supabase: supabase(), publicBucket, backupBucket, now: () => clock });

function variants(): PhotoVariants {
  const p = variantPlan(1200, 800);
  return {
    master: { w: p.master.w, h: p.master.h, bytes: 10 },
    webp: p.webp.map((e) => ({ tier: e.tier as 480, w: e.w, h: e.h, bytes: 10 })),
    jpeg: { w: p.jpeg.w, h: p.jpeg.h, bytes: 10 },
    og: { w: p.og.w, h: p.og.h, bytes: 10 },
  };
}

beforeAll(async () => {
  world = await makeWorld();
});
afterAll(() => world.close());
beforeEach(async () => {
  clock = T0;
  await world.db.exec(`
    delete from public.photos; delete from public.albums; delete from public.categories;
    insert into public.categories (id, slug, name, visible) values
      ('${CAT}', 'svatby', 'Svatby', true), ('${HIDDEN_CAT}', 'skryte', 'Skryte', false);
    insert into public.albums (id, category_id, slug, title, published) values
      ('${ALB_PUB}', '${CAT}', 'one', 'One', true), ('${ALB_DRAFT}', '${CAT}', 'draft', 'Draft', false);
    insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total) values
      ('${PHOTO}', '${ALB_PUB}', 'photos/${PHOTO}/master.jpg', 1200, 800, '${JSON.stringify(variants())}'::jsonb, 60),
      ('${PHOTO_DRAFT}', '${ALB_DRAFT}', 'photos/${PHOTO_DRAFT}/master.jpg', 1200, 800, '${JSON.stringify(variants())}'::jsonb, 60);
  `);
  await publicBucket.delete(publicBucket.keys());
  await backupBucket.delete(backupBucket.keys());
});

/** Capture the bytes the service writes, keyed by object key, by wrapping put. */
function capture(bucket: typeof publicBucket) {
  const bodies = new Map<string, Uint8Array>();
  const meta = new Map<string, { contentType: string; cacheControl?: string }>();
  const put = bucket.put.bind(bucket);
  bucket.put = async (key, body, opts) => {
    bodies.set(key, body);
    meta.set(key, opts);
    return put(key, body, opts);
  };
  return {
    bodies,
    meta,
    json: (key: string) => JSON.parse(new TextDecoder().decode(bodies.get(key)!)) as any,
    restore: () => {
      bucket.put = put;
    },
  };
}

describe('buildAndStoreSnapshot', () => {
  it('writes a snapshot equal to buildSnapshot of the same rows, valid, with Cache-Control no-cache', async () => {
    const cap = capture(publicBucket);
    const bcap = capture(backupBucket);
    try {
      const result = await buildAndStoreSnapshot(deps(), world.tokens.admin);
      const written = cap.json(SNAPSHOT_KEY);
      const rows = await loadCatalogRows(supabase(), world.tokens.admin);
      expect(written).toEqual(buildSnapshot(rows, T0));
      expect(SnapshotSchema.safeParse(written).success).toBe(true);
      expect(cap.meta.get(SNAPSHOT_KEY)).toEqual({ contentType: 'application/json', cacheControl: 'no-cache' });
      expect(result.snapshotBytes).toBe(cap.bodies.get(SNAPSHOT_KEY)!.byteLength);
      expect(result.counts).toEqual({ categories: 1, albums: 1, photos: 1 });
      expect(result.backupKey).toBe(backupKey(T0));

      // The snapshot carries updatedAt and leaves out the draft and the hidden category.
      const album = written.categories[0].albums[0];
      expect(album.slug).toBe('one');
      expect(Date.parse(album.updatedAt)).not.toBeNaN();
      expect(JSON.stringify(written)).not.toContain('draft');
      expect(JSON.stringify(written)).not.toContain(PHOTO_DRAFT);

      // The backup keeps everything, drafts included.
      const backup = bcap.json(backupKey(T0));
      expect(backup.schemaVersion).toBe(1);
      expect(backup.generatedAt).toBe(T0.toISOString());
      expect(backup.albums.map((a: { slug: string }) => a.slug).sort()).toEqual(['draft', 'one']);
      expect(backup.categories).toHaveLength(2);
      expect(backup.photos).toHaveLength(2);
      expect(bcap.meta.get(backupKey(T0))?.contentType).toBe('application/json');
      expect(await backupBucket.head(backupKey(T0))).not.toBeNull();
    } finally {
      cap.restore();
      bcap.restore();
    }
  });

  it('keeps only the newest 20 backups after 25 runs', async () => {
    for (let i = 0; i < 25; i++) {
      clock = new Date(T0.getTime() + i * 1000);
      await buildAndStoreSnapshot(deps(), world.tokens.admin);
    }
    const keys = backupBucket.keys();
    expect(keys).toHaveLength(BACKUPS_TO_KEEP);
    const expected = Array.from({ length: 20 }, (_, i) => backupKey(new Date(T0.getTime() + (i + 5) * 1000)));
    expect(keys).toEqual(expected);
    expect(publicBucket.keys()).toEqual([SNAPSHOT_KEY]);
  });

  it('pruning ignores files that are not backups', async () => {
    await backupBucket.put('notes.txt', new Uint8Array(1), { contentType: 'text/plain' });
    await backupBucket.put('full-old.json', new Uint8Array(1), { contentType: 'application/json' });
    expect(await pruneBackups(backupBucket, 0)).toBe(0);
    expect(backupBucket.keys()).toEqual(['full-old.json', 'notes.txt']);
  });

  it('throws SNAPSHOT_EMPTY before anything is written when no album is published', async () => {
    await world.db.exec('update public.albums set published = false');
    await expect(buildAndStoreSnapshot(deps(), world.tokens.admin)).rejects.toMatchObject({ code: 'SNAPSHOT_EMPTY' });
    expect(publicBucket.keys()).toEqual([]);
    expect(backupBucket.keys()).toEqual([]);
  });

  it('a non-admin token reads no rows and nothing is published', async () => {
    await expect(buildAndStoreSnapshot(deps(), world.tokens.nonAdmin)).rejects.toMatchObject({ code: 'SNAPSHOT_EMPTY' });
    expect(publicBucket.keys()).toEqual([]);
    expect(backupBucket.keys()).toEqual([]);
  });

  it('a failing read is a PublishServiceError and writes nothing', async () => {
    const failing = createSupabaseClient({
      supabaseUrl: SHIM_SUPABASE_URL,
      anonKey: SHIM_ANON_KEY,
      fetch: async () => new Response('x', { status: 500 }),
    });
    await expect(buildAndStoreSnapshot({ ...deps(), supabase: failing }, world.tokens.admin)).rejects.toBeInstanceOf(
      PublishServiceError,
    );
    expect(publicBucket.keys()).toEqual([]);
    expect(backupBucket.keys()).toEqual([]);
  });

  it('a failing write is UPSTREAM_ERROR', async () => {
    const broken = { ...publicBucket, put: async () => Promise.reject(new Error('r2 down')) };
    await expect(buildAndStoreSnapshot({ ...deps(), publicBucket: broken }, world.tokens.admin)).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
  });
});
