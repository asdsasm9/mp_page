// Cover and order (plan WP-06 step 11). FakeBackend only; no network, synthetic image bytes.
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { main } from '../migrate-legacy';
import { LEGACY_ALBUMS } from '../../packages/shared/src/legacy/albums';
import type { MigrationBackend } from './backend';
import { syncCatalog } from './catalog';
import { coversComplete, formatCovers, syncCovers } from './cover';
import { createFakeBackend, type FakeBackend } from './fake-backend';
import { preflight, uploadPhotos, type UploadDeps } from './upload';

let tiny: Buffer;
beforeAll(async () => {
  tiny = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#336699' } }).jpeg().toBuffer();
});

const deps = (extra: UploadDeps = {}): UploadDeps => ({ exists: () => true, read: async () => tiny, sleep: async () => {}, ...extra });
const count = (b: FakeBackend, op: string) => b.calls.filter((c) => c === op).length;

async function uploaded(album: string) {
  const b = createFakeBackend();
  await b.signIn();
  const catalog = await syncCatalog(b, { album });
  await uploadPhotos(b, await preflight(b, { album, limitBytes: null }, deps()), catalog.albumIds, deps());
  return { b, albumId: catalog.albumIds[album]! };
}

describe('syncCovers', () => {
  it('sets the cover to the photo of mainImgNum and reports the order as OK', async () => {
    const { b, albumId } = await uploaded('hradsti'); // mainImgNum 2
    const r = await syncCovers(b, { album: 'hradsti' });
    const cover = b.photos().find((p) => p.legacy_key === 'weddings/hradsti/2.jpg')!;
    expect(r.albums).toHaveLength(1);
    expect(r.albums[0]).toMatchObject({ id: 'hradsti', number: 2, coverId: cover.id, status: 'set', orderOk: true, found: 8, expected: 8 });
    expect(b.albums().find((a) => a.id === albumId)!.cover_photo_id).toBe(cover.id);
    expect(coversComplete(r)).toBe(true);
    expect(formatCovers(r).join('\n')).toContain(`cover 2 ${cover.id} set, order OK`);
  });

  it('skips an album whose cover is already the right one (no setCover call)', async () => {
    const { b } = await uploaded('hradsti');
    await syncCovers(b, { album: 'hradsti' });
    const calls = count(b, 'setCover');
    const again = await syncCovers(b, { album: 'hradsti' });
    expect(again.albums[0]!.status).toBe('already');
    expect(count(b, 'setCover')).toBe(calls);
  });

  it('reports a different existing cover as drift only and leaves it', async () => {
    const { b, albumId } = await uploaded('hradsti');
    const other = b.photos().find((p) => p.legacy_key === 'weddings/hradsti/5.jpg')!;
    await b.setCover(albumId, other.id);
    const calls = count(b, 'setCover');
    const r = await syncCovers(b, { album: 'hradsti' });
    expect(r.albums[0]).toMatchObject({ status: 'drift', foundCoverId: other.id });
    expect(count(b, 'setCover')).toBe(calls);
    expect(b.albums().find((a) => a.id === albumId)!.cover_photo_id).toBe(other.id);
    expect(coversComplete(r)).toBe(true);
    expect(formatCovers(r).join('\n')).toContain('DRIFT cover hradsti');
  });

  it('sets no cover while photos are missing', async () => {
    const b = createFakeBackend();
    await b.signIn();
    const catalog = await syncCatalog(b, { album: 'lucka' });
    const pre = await preflight(b, { album: 'lucka', limitBytes: null }, deps());
    pre.albums[0]!.pending = pre.albums[0]!.pending.slice(0, 3);
    await uploadPhotos(b, pre, catalog.albumIds, deps());
    const r = await syncCovers(b, { album: 'lucka' });
    expect(r.albums[0]).toMatchObject({ status: 'incomplete', found: 3, expected: 5, orderOk: null });
    expect(count(b, 'setCover')).toBe(0);
  });

  it('flags a wrong order (sort ranking differs from the file numbers)', async () => {
    const { b } = await uploaded('lucka');
    const swapped: MigrationBackend = {
      ...b,
      listPhotosByLegacyKey: async () => {
        const rows = await b.listPhotosByLegacyKey();
        const first = rows[0]!;
        const second = rows[1]!;
        [first.sort, second.sort] = [second.sort, first.sort];
        return rows;
      },
    };
    const r = await syncCovers(swapped, { album: 'lucka' });
    expect(r.albums[0]!.orderOk).toBe(false);
    expect(coversComplete(r)).toBe(false);
    expect(formatCovers(r).join('\n')).toContain('order WRONG');
  });
});

describe('full live run, 141 photos', () => {
  const env = { SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_ANON_KEY: 'k', API_BASE_URL: 'https://api.example.test', MIGRATE_ADMIN_EMAIL: 'a@example.test', MIGRATE_ADMIN_PASSWORD: 'pw' };

  it('sets all 13 covers per the table, orders are 1..n, the report shows both, a rerun changes nothing', async () => {
    const b = createFakeBackend();
    const out: string[] = [];
    const run = () => main(['--live', '--confirm-project', 'abcdefgh'], (l) => out.push(l), () => {}, { env, backend: b, upload: deps() });
    expect(await run()).toBe(0);
    expect(b.photos()).toHaveLength(141);
    const covers = new Map(b.albums().map((a) => [a.legacy_id, b.photos().find((p) => p.id === a.cover_photo_id)?.legacy_key] as const));
    expect(covers.size).toBe(13);
    for (const a of LEGACY_ALBUMS) expect(covers.get(a.id)).toBe(`${a.legacyCategory}/${a.id}/${a.mainImgNum}.jpg`);
    expect(covers.get('sedlakovi')).toMatch(/\/42\.jpg$/);
    expect(covers.get('anez')).toMatch(/\/9\.jpg$/);
    expect(covers.get('hradsti')).toMatch(/\/2\.jpg$/);
    expect(covers.get('pati')).toMatch(/\/5\.jpg$/);
    for (const a of LEGACY_ALBUMS) {
      const keys = b.photos().filter((p) => p.legacy_key!.startsWith(`${a.legacyCategory}/${a.id}/`)).sort((x, y) => x.sort - y.sort).map((p) => p.legacy_key);
      expect(keys).toEqual(Array.from({ length: a.photoCount }, (_, i) => `${a.legacyCategory}/${a.id}/${i + 1}.jpg`));
    }
    const text = out.join('\n');
    expect(text).toContain('covers set 13, already 0, drift 0, orders wrong 0');
    expect(text).toMatch(/sedlakovi\s+cover 42 /);
    expect(text.match(/RESULT:/g)).toHaveLength(1);
    expect(text).toContain('RESULT: OK');

    out.length = 0;
    const calls = count(b, 'setCover');
    expect(await run()).toBe(0);
    expect(count(b, 'setCover')).toBe(calls);
    expect(out.join('\n')).toContain('covers set 0, already 13, drift 0, orders wrong 0');
  }, 60_000);
});
