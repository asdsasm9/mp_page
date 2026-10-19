import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGACY_ALBUMS, LEGACY_CATEGORIES } from '../packages/shared/src/legacy/albums';
import { SnapshotSchema, assertPublishable, type Snapshot } from '../packages/shared/src/snapshot';
import {
  FIXTURE_NAMESPACE,
  LEGACY_GALLERIES_DIR,
  LEGACY_PHOTOS_JSON,
  SEED_SQL,
  SNAPSHOT_FIXTURE_JSON,
  fixtureColor,
  jpegSize,
  readLegacyPhotos,
  renderPart2,
  serializeLegacyPhotos,
  uuidV5,
} from './gen-fixtures';

describe('gen-fixtures part 2: seed.sql and snapshot.fixture.json', () => {
  const gen = renderPart2();

  it('drift: regenerating in memory equals the committed files', () => {
    expect(gen.seedSql).toBe(readFileSync(SEED_SQL, 'utf8'));
    expect(gen.snapshotJson).toBe(readFileSync(SNAPSHOT_FIXTURE_JSON, 'utf8'));
    expect(renderPart2().seedSql).toBe(gen.seedSql);
  });

  it('every photo has a deterministic #rrggbb dominant colour, in the seed and the fixture', () => {
    const fixture = JSON.parse(readFileSync(SNAPSHOT_FIXTURE_JSON, 'utf8')) as Snapshot;
    const photos = fixture.categories.flatMap((c) => c.albums).flatMap((a) => a.photos);
    expect(photos).toHaveLength(141);
    for (const p of photos) {
      expect(p.dominantColor, p.id).toMatch(/^#[0-9a-f]{6}$/);
      expect(p.dominantColor).toBe(fixtureColor(p.id));
    }
    expect(new Set(photos.map((p) => p.dominantColor)).size).toBeGreaterThan(5);
    for (const row of gen.rows.photos) expect(row.dominant_color).toMatch(/^#[0-9a-f]{6}$/);
    expect(gen.seedSql).toContain('dominant_color, sort, legacy_key');
  });

  it('uuidV5 is deterministic, v5-shaped and matches the RFC 4122 DNS example', () => {
    expect(uuidV5('x')).toBe(uuidV5('x'));
    expect(uuidV5('x')).not.toBe(uuidV5('y'));
    expect(uuidV5('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidV5('python.org', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
    expect(FIXTURE_NAMESPACE).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('the fixture parses, is publishable and has the legacy shape', () => {
    const fixture = JSON.parse(readFileSync(SNAPSHOT_FIXTURE_JSON, 'utf8')) as Snapshot;
    expect(SnapshotSchema.parse(fixture)).toEqual(fixture);
    expect(() => assertPublishable(fixture)).not.toThrow();
    expect(fixture.counts).toEqual({ categories: 3, albums: 13, photos: 141 });
    expect(fixture.categories.map((c) => c.name)).toEqual(['Svatby', 'Portréty', 'Párové focení']);
    expect(fixture.redirects).toEqual([]);
    const albums = fixture.categories.flatMap((c) => c.albums);
    for (const a of albums) expect(a.legacyId).toBe(a.slug);
    for (const la of LEGACY_ALBUMS) {
      const a = albums.find((x) => x.slug === la.id)!;
      expect(a.photos).toHaveLength(la.photoCount);
      const cover = gen.rows.photos.find((p) => p.legacy_key === `${la.legacyCategory}/${la.id}/${la.mainImgNum}.jpg`)!;
      expect(a.coverPhotoId).toBe(cover.id);
    }
    expect(fixture.categories.map((c) => c.slug)).toEqual(LEGACY_CATEGORIES.map((c) => c.slug));
  });

  it('bytes_total equals the variants sum for every photo and ids are unique', () => {
    const ids = new Set(gen.rows.photos.map((p) => p.id));
    expect(ids.size).toBe(141);
    for (const p of gen.rows.photos) {
      const v = p.variants;
      expect(p.bytes_total).toBe(v.master.bytes + v.webp.reduce((s, e) => s + e.bytes, 0) + v.jpeg.bytes + v.og.bytes);
      expect(p.master_key).toBe(`photos/${p.id}/master.jpg`);
    }
  });

  it('every fixture photo with a master of at least 720 px has a 720 WebP entry', () => {
    let withTier = 0;
    for (const p of gen.rows.photos) {
      const tiers = p.variants.webp.map((e) => e.tier);
      if (p.variants.master.w >= 720) {
        expect(tiers, p.id).toContain(720);
        withTier++;
      } else {
        expect(tiers, p.id).not.toContain(720);
      }
    }
    expect(withTier).toBeGreaterThan(0);
  });

  it('no file under packages/shared/fixtures exceeds 400 KB', () => {
    for (const f of [LEGACY_PHOTOS_JSON, SNAPSHOT_FIXTURE_JSON]) expect(statSync(f).size).toBeLessThan(400 * 1024);
  });
});

describe('gen-fixtures part 1', () => {
  it('regenerating produces a byte-identical legacy-photos.json (deterministic)', () => {
    const fresh = serializeLegacyPhotos(readLegacyPhotos());
    expect(fresh).toBe(readFileSync(LEGACY_PHOTOS_JSON, 'utf8'));
    expect(serializeLegacyPhotos(readLegacyPhotos())).toBe(fresh);
  });

  it('has 141 entries and the committed file stays small', () => {
    expect(readLegacyPhotos()).toHaveLength(141);
    expect(statSync(LEGACY_PHOTOS_JSON).size).toBeLessThan(400 * 1024);
  });

  it('jpegSize reads the SOF header and rejects non-jpeg', () => {
    const entry = readLegacyPhotos()[0]!;
    const buf = readFileSync(join(LEGACY_GALLERIES_DIR, ...entry.legacyKey.split('/')));
    expect(jpegSize(buf)).toEqual({ w: entry.width, h: entry.height });
    expect(jpegSize(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});
