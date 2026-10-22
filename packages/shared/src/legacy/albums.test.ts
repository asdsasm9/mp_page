import { describe, expect, it } from 'vitest';
import { isValidSlug } from '../slug';
import { LEGACY_ALBUMS, LEGACY_CATEGORIES, allLegacyKeys, legacyKey, legacyKeysOf } from './albums';

// Tests that read legacy-photos.json and the files on disk live in scripts/legacy-photos.test.ts
// (this package has no Node types so it stays usable in the browser).

describe('legacy albums', () => {
  it('has 3 categories in navigation order', () => {
    expect(LEGACY_CATEGORIES.map((c) => [c.legacy, c.slug, c.name, c.sort])).toEqual([
      ['weddings', 'svatby', 'Svatby', 10],
      ['portraits', 'portrety', 'Portréty', 20],
      ['couples', 'parove-foceni', 'Párové focení', 30],
    ]);
  });

  it('has 13 albums with the CONTENT-MAPPING counts', () => {
    expect(LEGACY_ALBUMS).toHaveLength(13);
    const counts = Object.fromEntries(LEGACY_ALBUMS.map((a) => [a.id, a.photoCount]));
    expect(counts).toEqual({
      frankovi: 5, hradsti: 8, sedlakovi: 44, suranovi: 5,
      anez: 9, lucka: 5, lukas: 7, mia: 20, pati: 12, pati2: 4,
      pavla_rafael: 11, helis_tom: 6, lucka_filip: 5,
    });
  });

  it('has 141 photos: 62 weddings, 57 portraits, 22 couples', () => {
    const sum = (c: string) => LEGACY_ALBUMS.filter((a) => a.legacyCategory === c).reduce((s, a) => s + a.photoCount, 0);
    expect(sum('weddings')).toBe(62);
    expect(sum('portraits')).toBe(57);
    expect(sum('couples')).toBe(22);
    expect(allLegacyKeys()).toHaveLength(141);
  });

  it('covers follow mainImgNum', () => {
    const cover = (id: string) => LEGACY_ALBUMS.find((a) => a.id === id)!.mainImgNum;
    expect(cover('sedlakovi')).toBe(42);
    expect(cover('pati')).toBe(5);
    expect(cover('anez')).toBe(9);
    expect(cover('hradsti')).toBe(2);
    for (const a of LEGACY_ALBUMS) {
      expect(a.mainImgNum).toBeGreaterThanOrEqual(1);
      expect(a.mainImgNum).toBeLessThanOrEqual(a.photoCount);
    }
  });

  it('every album belongs to a category and the slug is a valid legacy slug', () => {
    for (const a of LEGACY_ALBUMS) {
      const c = LEGACY_CATEGORIES.find((x) => x.legacy === a.legacyCategory)!;
      expect(c.slug).toBe(a.categorySlug);
      expect(isValidSlug(a.id, { legacy: true })).toBe(true);
    }
    expect(new Set(LEGACY_ALBUMS.map((a) => a.id)).size).toBe(13);
  });

  it('sort is unique inside a category and ascending in listing order', () => {
    for (const c of LEGACY_CATEGORIES) {
      const sorts = LEGACY_ALBUMS.filter((a) => a.legacyCategory === c.legacy).map((a) => a.sort);
      expect(sorts).toEqual([...sorts].sort((x, y) => x - y));
      expect(new Set(sorts).size).toBe(sorts.length);
    }
  });

  it('only Lucka & Filip has a place (Brno)', () => {
    expect(LEGACY_ALBUMS.filter((a) => a.place !== null).map((a) => [a.id, a.place])).toEqual([['lucka_filip', 'Brno']]);
  });

  it('legacyKey format', () => {
    expect(legacyKey('weddings', 'sedlakovi', 42)).toBe('weddings/sedlakovi/42.jpg');
    expect(legacyKeysOf(LEGACY_ALBUMS[0]!)).toEqual([1, 2, 3, 4, 5].map((n) => `weddings/frankovi/${n}.jpg`));
  });
});
