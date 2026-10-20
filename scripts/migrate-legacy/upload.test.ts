// Photo upload path with quota guard (plan WP-06 step 9) against the FakeBackend only. No network, no real legacy files.
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { main } from '../migrate-legacy';
import { LEGACY_ALBUMS } from '../../packages/shared/src/legacy/albums';
import { BackendError, type MigrationBackend } from './backend';
import { syncCatalog } from './catalog';
import { createFakeBackend, type FakeBackend } from './fake-backend';
import { formatUpload, preflight, uploadComplete, uploadPhotos, type Preflight, type UploadDeps } from './upload';
import { tempReportDir } from './report-dir.helper';
import type { MigrateOptions } from './types';

let tiny: Buffer;
beforeAll(async () => {
  tiny = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#336699' } }).jpeg().toBuffer();
});

const sleeps: number[] = [];
const deps = (extra: UploadDeps = {}): UploadDeps => ({
  exists: () => true,
  read: async () => tiny,
  sleep: async (ms) => {
    sleeps.push(ms);
  },
  ...extra,
});
const opts = (album: string | null): Pick<MigrateOptions, 'album' | 'limitBytes'> => ({ album, limitBytes: null });

async function setup(album: string | null, backendOptions: Parameters<typeof createFakeBackend>[0] = {}) {
  const b = createFakeBackend(backendOptions);
  await b.signIn();
  const catalog = await syncCatalog(b, { album });
  return { b, albumIds: catalog.albumIds };
}

const count = (b: FakeBackend, op: string) => b.calls.filter((c) => c === op).length;
const WRITES = ['upsertCategory', 'upsertAlbum', 'setCover', 'reserve', 'put', 'commit'];

describe('uploadPhotos', () => {
  it('inserts every photo of the album in file-number order with the commit fields', async () => {
    const { b, albumIds } = await setup('frankovi');
    const pre = await preflight(b, opts('frankovi'), deps());
    expect(pre.refusal).toBeNull();
    const r = await uploadPhotos(b, pre, albumIds, deps());
    expect(r).toMatchObject({ inserted: 5, skipped: 0, failed: 0, aborted: null });
    expect(uploadComplete(r)).toBe(true);
    expect(count(b, 'reserve')).toBe(1);
    const rows = b.photos();
    expect(rows.map((p) => p.legacy_key)).toEqual([1, 2, 3, 4, 5].map((n) => `weddings/frankovi/${n}.jpg`));
    expect(rows.map((p) => p.sort)).toEqual([10, 20, 30, 40, 50]);
    for (const p of rows) {
      expect(p.dominant_color).toMatch(/^#[0-9a-f]{6}$/);
      expect(p.alt).toBeNull();
      expect(p.bytes_total).toBeGreaterThan(0);
      expect(p.album_id).toBe(albumIds['frankovi']);
    }
    expect(r.bytes).toBe(rows.reduce((s, p) => s + p.bytes_total, 0));
    expect(r.quotaAfter).toBe(r.bytes);
    expect(formatUpload(r).at(-1)).toBe('RESULT: OK');
  });

  it('a second run skips the existing rows and reserves nothing', async () => {
    const { b, albumIds } = await setup('lucka');
    await uploadPhotos(b, await preflight(b, opts('lucka'), deps()), albumIds, deps());
    const reserves = count(b, 'reserve');
    const pre = await preflight(b, opts('lucka'), deps());
    expect(pre.need).toBe(0);
    const r = await uploadPhotos(b, pre, albumIds, deps());
    expect([r.inserted, r.skipped, r.failed]).toEqual([0, 5, 0]);
    expect(count(b, 'reserve')).toBe(reserves);
    expect(b.photos()).toHaveLength(5);
  });

  it('retries a PUT network error with injected backoff and succeeds', async () => {
    const { b, albumIds } = await setup('pati2');
    sleeps.length = 0;
    b.failNext('put', 'network', 2);
    const r = await uploadPhotos(b, await preflight(b, opts('pati2'), deps()), albumIds, deps({ concurrency: 1 }));
    expect([r.inserted, r.failed]).toEqual([4, 0]);
    expect(sleeps).toEqual([500, 1000]);
  });

  it('gives up after 3 retries on one photo, keeps going, and reports INCOMPLETE', async () => {
    const { b, albumIds } = await setup('pati2');
    sleeps.length = 0;
    b.failNext('put', 'network', 4);
    const r = await uploadPhotos(b, await preflight(b, opts('pati2'), deps()), albumIds, deps({ concurrency: 1 }));
    expect([r.inserted, r.failed]).toEqual([3, 1]);
    expect(sleeps).toEqual([500, 1000, 2000]);
    expect(uploadComplete(r)).toBe(false);
    expect(formatUpload(r).at(-1)).toBe('RESULT: INCOMPLETE');
    expect(r.albums[0]!.errors[0]).toContain('NETWORK');
  });

  it('does not retry a non-retryable PUT rejection', async () => {
    const { b, albumIds } = await setup('pati2');
    sleeps.length = 0;
    b.failNext('put', new BackendError('PUT_REJECTED'), 1);
    const r = await uploadPhotos(b, await preflight(b, opts('pati2'), deps()), albumIds, deps({ concurrency: 1 }));
    expect([r.inserted, r.failed]).toEqual([3, 1]);
    expect(sleeps).toEqual([]);
  });

  it('re-reserves once on an expired presign and then succeeds', async () => {
    const { b, albumIds } = await setup('pati2');
    b.failNext('put', new BackendError('PRESIGN_EXPIRED'), 1);
    const r = await uploadPhotos(b, await preflight(b, opts('pati2'), deps()), albumIds, deps({ concurrency: 1 }));
    expect([r.inserted, r.failed]).toEqual([4, 0]);
    expect(count(b, 'reserve')).toBe(2);
  });

  it('fails the photo when the presign expires again after the one re-reserve', async () => {
    const { b, albumIds } = await setup('pati2');
    b.failNext('put', new BackendError('PRESIGN_EXPIRED'), 2);
    const r = await uploadPhotos(b, await preflight(b, opts('pati2'), deps()), albumIds, deps({ concurrency: 1 }));
    expect([r.inserted, r.failed]).toEqual([3, 1]);
    expect(count(b, 'reserve')).toBe(2);
  });

  it('limit hit mid-run stops at the first refusal, used <= hard, not complete', async () => {
    const { b, albumIds } = await setup(null);
    const first = await preflight(b, opts('frankovi'), deps());
    const second = await preflight(b, opts('lucka'), deps());
    const pre: Preflight = { ...first, albums: [...first.albums, ...second.albums], need: first.need + second.need };
    let reserves = 0;
    const squeezed: MigrationBackend = {
      ...b,
      async reserve(req) {
        // The quota shrinks after the first album (someone else filled the bucket).
        if (++reserves === 2) b.setLimits({ quotaHardBytes: b.photos().reduce((s, p) => s + p.bytes_total, 0) });
        return b.reserve(req);
      },
    };
    const r = await uploadPhotos(squeezed, pre, albumIds, deps());
    expect(r.aborted).toBe('STORAGE_FULL');
    expect(r.inserted).toBe(5);
    expect(b.photos()).toHaveLength(5);
    expect(count(b, 'commit')).toBe(5);
    expect(r.quotaAfter!).toBeLessThanOrEqual((await b.storage()).hard);
    expect(uploadComplete(r)).toBe(false);
    expect(formatUpload(r).join('\n')).toContain('ABORTED: STORAGE_FULL');
  });

  it('FILE_TOO_LARGE aborts the run before any PUT', async () => {
    const { b, albumIds } = await setup('lucka', { limits: { maxUploadBytes: 100 } });
    const r = await uploadPhotos(b, await preflight(b, opts('lucka'), deps()), albumIds, deps());
    expect(r.aborted).toBe('FILE_TOO_LARGE');
    expect(count(b, 'put')).toBe(0);
    expect(b.photos()).toHaveLength(0);
  });

  it('commit STORAGE_FULL aborts the run too', async () => {
    const { b, albumIds } = await setup('lucka');
    b.failNext('commit', new BackendError('STORAGE_FULL'), 1);
    const r = await uploadPhotos(b, await preflight(b, opts('lucka'), deps()), albumIds, deps());
    expect(r.aborted).toBe('STORAGE_FULL');
    expect(count(b, 'commit')).toBe(1);
  });
});

describe('preflight', () => {
  it('refuses with zero writes when used + need would exceed hard', async () => {
    const b = createFakeBackend({ limits: { quotaHardBytes: 1000, quotaWarnBytes: 500 } });
    await b.signIn();
    const pre = await preflight(b, opts('frankovi'), deps());
    expect(pre.refusal).toContain('hard limit');
    expect(pre.need).toBeGreaterThan(1000);
    expect(b.calls.filter((c) => WRITES.includes(c))).toEqual([]);
  });

  it('through main: refusal exits 1 and not even the catalog is written', async () => {
    const b = createFakeBackend({ limits: { quotaHardBytes: 1000, quotaWarnBytes: 500 } });
    const out: string[] = [];
    const err: string[] = [];
    const env = { SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_ANON_KEY: 'k', API_BASE_URL: 'https://api.example.test', MIGRATE_ADMIN_EMAIL: 'a@example.test', MIGRATE_ADMIN_PASSWORD: 'pw' };
    const code = await main(['--live', '--confirm-project', 'abcdefgh', '--album', 'frankovi'], (l) => out.push(l), (l) => err.push(l), { env, backend: b, upload: deps(), reportDir: tempReportDir() });
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('refused, nothing was written');
    expect(b.calls.filter((c) => WRITES.includes(c))).toEqual([]);
    expect(b.albums()).toHaveLength(0);
  });

  it('warns when the run crosses the warn level but still fits', async () => {
    const b = createFakeBackend({ limits: { quotaWarnBytes: 1000 } });
    await b.signIn();
    const pre = await preflight(b, opts('frankovi'), deps());
    expect(pre.refusal).toBeNull();
    expect(pre.warn).toBe(true);
    const out: string[] = [];
    const env = { SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_ANON_KEY: 'k', API_BASE_URL: 'https://api.example.test', MIGRATE_ADMIN_EMAIL: 'a@example.test', MIGRATE_ADMIN_PASSWORD: 'pw' };
    const code = await main(['--live', '--confirm-project', 'abcdefgh', '--album', 'frankovi'], (l) => out.push(l), () => {}, { env, backend: b, upload: deps(), reportDir: tempReportDir() });
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('WARNING: this run crosses the storage warn level');
  });

  it('refuses when --limit-bytes is below the need', async () => {
    const b = createFakeBackend();
    await b.signIn();
    const pre = await preflight(b, { album: 'frankovi', limitBytes: 10 }, deps());
    expect(pre.refusal).toContain('--limit-bytes');
  });

  it('covers all 13 albums and 141 photos when nothing exists yet', async () => {
    const b = createFakeBackend();
    await b.signIn();
    const pre = await preflight(b, opts(null), deps());
    expect(pre.albums).toHaveLength(LEGACY_ALBUMS.length);
    expect(pre.albums.reduce((s, a) => s + a.pending.length, 0)).toBe(141);
  }, 60_000);
});
