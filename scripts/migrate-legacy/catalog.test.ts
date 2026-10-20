// Catalog upsert (plan WP-06 step 8) against the FakeBackend only.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { main } from '../migrate-legacy';
import { LEGACY_ALBUMS, LEGACY_CATEGORIES } from '../../packages/shared/src/legacy/albums';
import { albumIdOf, categoryIdOf, formatCatalog, syncCatalog } from './catalog';
import { createFakeBackend } from './fake-backend';
import type { MigrateOptions } from './types';

const all: Pick<MigrateOptions, 'album'> = { album: null };
const signedIn = async (isAdmin = true) => {
  const b = createFakeBackend({ isAdmin });
  await b.signIn();
  return b;
};

describe('syncCatalog', () => {
  it('creates 3 categories and 13 albums with the CONTENT-MAPPING values', async () => {
    const b = await signedIn();
    const r = await syncCatalog(b, all);
    expect([r.categoriesCreated, r.albumsCreated, r.categoriesExisting, r.albumsExisting, r.drift.length]).toEqual([3, 13, 0, 0, 0]);
    const cats = b.categories();
    expect(cats.map((c) => [c.slug, c.name, c.sort, c.visible])).toEqual(
      LEGACY_CATEGORIES.map((c) => [c.slug, c.name, c.sort, true]),
    );
    const albums = b.albums();
    expect(albums).toHaveLength(13);
    for (const a of LEGACY_ALBUMS) {
      const row = albums.find((x) => x.legacy_id === a.id)!;
      expect(row).toMatchObject({ slug: a.id, title: a.title, place: a.place, sort: a.sort, published: true, cover_photo_id: null, id: albumIdOf(a.id) });
      expect(row.category_id).toBe(categoryIdOf(a.categorySlug));
      expect(r.albumIds[a.id]).toBe(row.id);
    }
    expect(albums.find((x) => x.legacy_id === 'lucka_filip')!.place).toBe('Brno');
  });

  it('a second run adds nothing and reports no drift', async () => {
    const b = await signedIn();
    await syncCatalog(b, all);
    const r = await syncCatalog(b, all);
    expect([r.categoriesCreated, r.albumsCreated, r.categoriesExisting, r.albumsExisting, r.drift.length]).toEqual([0, 0, 3, 13, 0]);
    expect(b.categories()).toHaveLength(3);
    expect(b.albums()).toHaveLength(13);
  });

  it('a renamed or re-sorted album is drift and is never overwritten', async () => {
    const b = await signedIn();
    await syncCatalog(b, all);
    const row = (b.albums().find((a) => a.legacy_id === 'mia'))!;
    // Tamper through the only mutation the backend offers by recreating the world: use a fresh backend seeded with a drifted album.
    const b2 = await signedIn();
    const cat = LEGACY_CATEGORIES[1]!;
    const c = await b2.upsertCategory({ id: categoryIdOf(cat.slug), slug: cat.slug, name: 'Jiné jméno', sort: 99 });
    await b2.upsertAlbum({ id: row.id, category_id: c.id, slug: 'mia', title: 'Mia renamed', place: 'Praha', sort: 7, legacy_id: 'mia', published: true });
    const r = await syncCatalog(b2, all);
    expect(r.albumsCreated).toBe(12);
    expect(r.albumsExisting).toBe(1);
    expect(r.categoriesExisting).toBe(1);
    expect(r.drift.map((d) => `${d.kind}:${d.ref}:${d.field}`).sort()).toEqual(
      ['album:mia:place', 'album:mia:sort', 'album:mia:title', 'category:portrety:name', 'category:portrety:sort'].sort(),
    );
    const stored = b2.albums().find((a) => a.legacy_id === 'mia')!;
    expect([stored.title, stored.place, stored.sort]).toEqual(['Mia renamed', 'Praha', 7]);
    expect(b2.categories().find((x) => x.slug === 'portrety')!.name).toBe('Jiné jméno');
    expect(formatCatalog(r).join('\n')).toContain('DRIFT album mia title');
    // and a repeat stays stable
    expect((await syncCatalog(b2, all)).drift).toHaveLength(5);
  });

  it('--album limits the run to one album and its category', async () => {
    const b = await signedIn();
    const r = await syncCatalog(b, { album: 'lucka_filip' });
    expect([r.categoriesCreated, r.albumsCreated]).toEqual([1, 1]);
    expect(b.albums().map((a) => a.legacy_id)).toEqual(['lucka_filip']);
    expect(b.categories().map((c) => c.slug)).toEqual(['parove-foceni']);
  });

  it('writes nothing for a non-admin', async () => {
    const b = createFakeBackend({ isAdmin: false });
    await expect(b.signIn()).rejects.toMatchObject({ code: 'NOT_ADMIN' });
    await expect(syncCatalog(b, all)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(b.categories()).toHaveLength(0);
    expect(b.albums()).toHaveLength(0);
  });
});

describe('migrate-legacy --live catalog phase', () => {
  const env = {
    SUPABASE_URL: 'https://abcdefgh.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    API_BASE_URL: 'https://api.example.test',
    MIGRATE_ADMIN_EMAIL: 'admin@example.test',
    MIGRATE_ADMIN_PASSWORD: 'SENTINEL-pw',
  };
  const run = async (backend: ReturnType<typeof createFakeBackend>, extra: string[] = []) => {
    const out: string[] = [];
    const err: string[] = [];
    // Synthetic tiny sources keep the photo phase fast; the real legacy files are never read here.
    const upload = { exists: () => true, read: async () => tiny, sleep: async () => {} };
    const code = await main(['--live', '--confirm-project', 'abcdefgh', ...extra], (l) => out.push(l), (l) => err.push(l), { env, backend, upload, reportDir: mkdtempSync(join(tmpdir(), 'mig-cat-')) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  let tiny: Buffer;
  beforeAll(async () => {
    tiny = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#336699' } }).jpeg().toBuffer();
  });

  it('writes the catalog, then the photos (details in upload.test.ts)', async () => {
    const b = createFakeBackend();
    const r = await run(b);
    expect(r.code).toBe(0);
    expect(r.out).toContain('categories created 3 existing 0, albums created 13 existing 0, drift 0');
    expect(r.out).toContain('RESULT: OK');
    expect(b.albums()).toHaveLength(13);
    expect(b.photos()).toHaveLength(141);
    expect(`${r.out}${r.err}`).not.toContain('SENTINEL-pw');
  }, 60_000);

  it('a second run reports existing rows', async () => {
    const b = createFakeBackend();
    await run(b);
    const r = await run(b);
    expect(r.out).toContain('created 0 existing 3, albums created 0 existing 13, drift 0');
    expect(b.albums()).toHaveLength(13);
  }, 60_000);

  it('a non-admin writes nothing', async () => {
    const b = createFakeBackend({ isAdmin: false });
    const r = await run(b);
    expect(r.code).toBe(1);
    expect(b.calls).toEqual(['signIn']);
  }, 60_000);

  it('a catalog failure prints only the code and exits 1', async () => {
    const b = createFakeBackend();
    b.failNext('upsertAlbum', 'server');
    const r = await run(b);
    expect(r.code).toBe(1);
    expect(r.err).toContain('catalog phase failed (SERVER_ERROR)');
  }, 60_000);
});
