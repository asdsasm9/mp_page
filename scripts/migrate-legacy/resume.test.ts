// Idempotency and resume (plan WP-06 step 10): --repair, crash between PUT and commit, --album in live,
// per-item reserve refusals. FakeBackend only; no network, synthetic image bytes.
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { main } from '../migrate-legacy';
import { allKeys } from '../../packages/shared/src';
import { BackendError, type MigrationBackend } from './backend';
import { syncCatalog } from './catalog';
import { createFakeBackend, type FakeBackend } from './fake-backend';
import { tempReportDir } from './report-dir.helper';
import { formatUpload, preflight, uploadComplete, uploadPhotos, type UploadDeps } from './upload';

let tiny: Buffer;
beforeAll(async () => {
  tiny = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#336699' } }).jpeg().toBuffer();
});

const deps = (extra: UploadDeps = {}): UploadDeps => ({ exists: () => true, read: async () => tiny, sleep: async () => {}, ...extra });
const count = (b: FakeBackend, op: string) => b.calls.filter((c) => c === op).length;

async function setup(album: string | null, backendOptions: Parameters<typeof createFakeBackend>[0] = {}) {
  const b = createFakeBackend(backendOptions);
  await b.signIn();
  const catalog = await syncCatalog(b, { album });
  return { b, albumIds: catalog.albumIds };
}

/** Every object in the bucket belongs to a stored row, and every row has all of its objects. */
async function expectConsistent(b: FakeBackend) {
  const rows = b.photos();
  const expected = rows.flatMap((p) => allKeys(p.id, p.variants)).sort();
  expect(b.storageFake.keys().sort()).toEqual(expected);
  const legacy = rows.map((p) => p.legacy_key);
  expect(new Set(legacy).size).toBe(legacy.length);
}

describe('--repair', () => {
  async function withDeletedObject(backendOptions: Parameters<typeof createFakeBackend>[0] = {}) {
    const { b, albumIds } = await setup('lucka', backendOptions);
    await uploadPhotos(b, await preflight(b, { album: 'lucka', limitBytes: null }, deps()), albumIds, deps());
    const victim = b.photos()[2]!;
    await b.storageFake.delete(allKeys(victim.id, victim.variants)[3]!);
    return { b, albumIds, victim };
  }

  it('reports a row with a missing object as missing, writes nothing, and is INCOMPLETE', async () => {
    const { b, albumIds } = await withDeletedObject();
    const pre = await preflight(b, { album: 'lucka', limitBytes: null }, deps());
    expect(pre.albums[0]!.missing.map((p) => p.legacyKey)).toEqual([b.photos()[2]!.legacy_key]);
    const puts = count(b, 'put');
    const r = await uploadPhotos(b, pre, albumIds, deps());
    expect([r.inserted, r.skipped, r.missing, r.repaired, r.failed]).toEqual([0, 4, 1, 0, 0]);
    expect(count(b, 'put')).toBe(puts);
    expect(uploadComplete(r)).toBe(false);
    const text = formatUpload(r).join('\n');
    expect(text).toContain('--repair cannot restore them against the live Worker');
    expect(text).toContain('deleting the photo in the admin');
  });

  it('re-uploads and re-commits the missing photo, keeps its sort, and a repeat is a no-op', async () => {
    const { b, albumIds, victim } = await withDeletedObject({ reserveExisting: true });
    const opts = { album: 'lucka', limitBytes: null, repair: true };
    const r = await uploadPhotos(b, await preflight(b, opts, deps({ repair: true })), albumIds, deps({ repair: true }));
    expect([r.inserted, r.skipped, r.missing, r.repaired, r.failed]).toEqual([0, 4, 0, 1, 0]);
    expect(uploadComplete(r)).toBe(true);
    expect(b.photos()).toHaveLength(5);
    expect(b.photos().find((p) => p.id === victim.id)!.sort).toBe(victim.sort);
    await expectConsistent(b);

    const puts = count(b, 'put');
    const again = await uploadPhotos(b, await preflight(b, opts, deps({ repair: true })), albumIds, deps({ repair: true }));
    expect([again.inserted, again.skipped, again.missing, again.repaired, again.failed]).toEqual([0, 5, 0, 0, 0]);
    expect(count(b, 'put')).toBe(puts);
  });

  it('fails only the repair, with a clear label, when the Worker refuses to presign an existing photo', async () => {
    const { b, albumIds } = await withDeletedObject();
    const opts = { album: 'lucka', limitBytes: null, repair: true };
    const r = await uploadPhotos(b, await preflight(b, opts, deps({ repair: true })), albumIds, deps({ repair: true }));
    expect([r.repaired, r.failed, r.missing]).toEqual([0, 1, 1]);
    expect(r.albums[0]!.errors[0]).toContain('repair refused');
    expect(uploadComplete(r)).toBe(false);
  });
});

describe('crash resume', () => {
  it('a run killed after the PUTs but before a commit completes on rerun without duplicates or orphans', async () => {
    const { b, albumIds } = await setup('frankovi');
    let commits = 0;
    const dying: MigrationBackend = {
      ...b,
      async commit(req) {
        if (++commits > 2) throw new Error('killed');
        return b.commit(req);
      },
      async storage() {
        if (commits > 2) throw new Error('killed');
        return b.storage();
      },
    };
    await expect(uploadPhotos(dying, await preflight(b, { album: 'frankovi', limitBytes: null }, deps()), albumIds, deps())).rejects.toThrow('killed');
    expect(b.photos()).toHaveLength(2);
    // Orphans exist right now: objects of the three uncommitted photos.
    expect(b.storageFake.keys().length).toBeGreaterThan(b.photos().flatMap((p) => allKeys(p.id, p.variants)).length);

    const pre = await preflight(b, { album: 'frankovi', limitBytes: null }, deps());
    expect(pre.albums[0]!.pending).toHaveLength(3);
    const r = await uploadPhotos(b, pre, albumIds, deps());
    expect([r.inserted, r.skipped, r.failed]).toEqual([3, 2, 0]);
    expect(uploadComplete(r)).toBe(true);
    expect(b.photos().map((p) => p.sort)).toEqual([10, 20, 30, 40, 50]);
    await expectConsistent(b);
  });
});

describe('--album in live mode', () => {
  const env = { SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_ANON_KEY: 'k', API_BASE_URL: 'https://api.example.test', MIGRATE_ADMIN_EMAIL: 'a@example.test', MIGRATE_ADMIN_PASSWORD: 'pw' };
  const live = (b: FakeBackend, extra: string[]) => main(['--live', '--confirm-project', 'abcdefgh', ...extra], () => {}, () => {}, { env, backend: b, upload: deps(), reportDir: tempReportDir() });

  it('writes only the chosen album and a later run for another album leaves the first alone', async () => {
    const b = createFakeBackend();
    expect(await live(b, ['--album', 'frankovi'])).toBe(0);
    expect(b.albums().map((a) => a.legacy_id)).toEqual(['frankovi']);
    expect(b.photos()).toHaveLength(5);
    const before = b.photos();

    expect(await live(b, ['--album', 'lucka'])).toBe(0);
    expect(b.albums()).toHaveLength(2);
    expect(b.photos()).toHaveLength(10);
    expect(b.photos().slice(0, 5)).toEqual(before);
    await expectConsistent(b);
  });
});

describe('reserve refusals', () => {
  it('an unexpected per-item refusal code fails only that photo with a generic label', async () => {
    const { b, albumIds } = await setup('lucka');
    const odd: MigrationBackend = {
      ...b,
      async reserve(req) {
        const res = await b.reserve(req);
        const first = res.items[0]! as { ok: boolean; code?: string; uploads?: unknown };
        first.ok = false;
        first.code = 'WEIRD';
        delete first.uploads;
        return res;
      },
    };
    const r = await uploadPhotos(odd, await preflight(b, { album: 'lucka', limitBytes: null }, deps()), albumIds, deps());
    expect(r.aborted).toBeNull();
    expect([r.inserted, r.failed]).toEqual([4, 1]);
    expect(r.albums[0]!.errors[0]).toContain('reserve refused (WEIRD)');
    expect(uploadComplete(r)).toBe(false);
  });

  it('a photo the reserve answer leaves out fails alone', async () => {
    const { b, albumIds } = await setup('lucka');
    const short: MigrationBackend = {
      ...b,
      async reserve(req) {
        const res = await b.reserve(req);
        res.items.shift();
        return res;
      },
    };
    const r = await uploadPhotos(short, await preflight(b, { album: 'lucka', limitBytes: null }, deps()), albumIds, deps());
    expect([r.inserted, r.failed, r.aborted]).toEqual([4, 1, null]);
  });

  it('STORAGE_FULL still aborts the run and keeps its own label', async () => {
    const { b, albumIds } = await setup('lucka');
    b.failNext('reserve', new BackendError('STORAGE_FULL'), 1);
    const r = await uploadPhotos(b, await preflight(b, { album: 'lucka', limitBytes: null }, deps()), albumIds, deps());
    expect(r.aborted).toBe('STORAGE_FULL');
  });
});

describe('full 141-photo fake run', () => {
  it('second run inserts 0 and skips 141 with identical counts', async () => {
    const { b, albumIds } = await setup(null);
    const first = await uploadPhotos(b, await preflight(b, { album: null, limitBytes: null }, deps()), albumIds, deps());
    expect([first.inserted, first.skipped, first.failed]).toEqual([141, 0, 0]);
    const second = await uploadPhotos(b, await preflight(b, { album: null, limitBytes: null }, deps()), albumIds, deps());
    expect([second.inserted, second.skipped, second.failed, second.missing]).toEqual([0, 141, 0, 0]);
    expect(second.albums.map((a) => a.found)).toEqual(first.albums.map((a) => a.found));
    expect(b.photos()).toHaveLength(141);
    await expectConsistent(b);
  }, 60_000);
});
