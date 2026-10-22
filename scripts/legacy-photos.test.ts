import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGACY_ALBUMS, allLegacyKeys } from '../packages/shared/src/legacy/albums';
import { LEGACY_GALLERIES_DIR, LEGACY_PHOTOS_JSON } from './gen-fixtures';

interface Entry {
  legacyKey: string;
  width: number;
  height: number;
  bytes: number;
}
const photos: Entry[] = JSON.parse(readFileSync(LEGACY_PHOTOS_JSON, 'utf8'));

describe('legacy-photos.json', () => {
  it('has one entry per legacy key in order, with sane values', () => {
    expect(photos).toHaveLength(141);
    expect(photos.map((p) => p.legacyKey)).toEqual(allLegacyKeys());
    for (const p of photos) {
      expect(Object.keys(p).sort()).toEqual(['bytes', 'height', 'legacyKey', 'width']);
      expect(p.width).toBeGreaterThan(0);
      expect(p.height).toBeGreaterThan(0);
      expect(p.bytes).toBeGreaterThan(0);
    }
  });

  it('every legacyKey file exists on disk and its byte size matches', () => {
    for (const p of photos) {
      const file = join(LEGACY_GALLERIES_DIR, ...p.legacyKey.split('/'));
      expect(existsSync(file), p.legacyKey).toBe(true);
      expect(statSync(file).size, p.legacyKey).toBe(p.bytes);
    }
  });

  it('numbering has no gaps (1..n per album) and per-category totals are 62, 57, 22', () => {
    for (const a of LEGACY_ALBUMS) {
      const nums = photos
        .filter((p) => p.legacyKey.startsWith(`${a.legacyCategory}/${a.id}/`))
        .map((p) => Number(p.legacyKey.split('/')[2]!.replace('.jpg', '')));
      expect(nums).toEqual(Array.from({ length: a.photoCount }, (_, i) => i + 1));
    }
    const per = (c: string) => photos.filter((p) => p.legacyKey.startsWith(`${c}/`)).length;
    expect([per('weddings'), per('portraits'), per('couples')]).toEqual([62, 57, 22]);
  });
});
