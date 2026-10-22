/**
 * The legacy catalog exactly as in docs/CONTENT-MAPPING.md sections 3 and 4:
 * 3 categories, 13 albums, 141 photos. Used by the fixtures, the seed and the migration.
 */

export type LegacyCategoryKey = 'weddings' | 'portraits' | 'couples';

export interface LegacyCategory {
  /** The old enum value, used in file paths and legacy keys. */
  legacy: LegacyCategoryKey;
  slug: string;
  name: string;
  sort: number;
}

export interface LegacyAlbum {
  /** Old id, equals the new slug (underscores kept on purpose). */
  id: string;
  legacyCategory: LegacyCategoryKey;
  categorySlug: string;
  title: string;
  place: string | null;
  photoCount: number;
  /** File number of the cover photo. */
  mainImgNum: number;
  /** Position inside its category. */
  sort: number;
}

/** Navigation order: Svatby, Portréty, Párové focení. */
export const LEGACY_CATEGORIES: readonly LegacyCategory[] = [
  { legacy: 'weddings', slug: 'svatby', name: 'Svatby', sort: 10 },
  { legacy: 'portraits', slug: 'portrety', name: 'Portréty', sort: 20 },
  { legacy: 'couples', slug: 'parove-foceni', name: 'Párové focení', sort: 30 },
];

const a = (
  id: string,
  legacyCategory: LegacyCategoryKey,
  categorySlug: string,
  title: string,
  place: string | null,
  photoCount: number,
  mainImgNum: number,
  sort: number,
): LegacyAlbum => ({ id, legacyCategory, categorySlug, title, place, photoCount, mainImgNum, sort });

export const LEGACY_ALBUMS: readonly LegacyAlbum[] = [
  a('frankovi', 'weddings', 'svatby', 'Michal & Rozárka', null, 5, 1, 10),
  a('hradsti', 'weddings', 'svatby', 'Jitka & Tomáš', null, 8, 2, 20),
  a('sedlakovi', 'weddings', 'svatby', 'Adam & Eliška', null, 44, 42, 30),
  a('suranovi', 'weddings', 'svatby', 'Broňa a Prokop', null, 5, 1, 40),
  a('anez', 'portraits', 'portrety', 'Anež', null, 9, 9, 10),
  a('lucka', 'portraits', 'portrety', 'Lucka', null, 5, 1, 20),
  a('lukas', 'portraits', 'portrety', 'Lukáš', null, 7, 1, 30),
  a('mia', 'portraits', 'portrety', 'Mia', null, 20, 1, 40),
  a('pati', 'portraits', 'portrety', 'Pati', null, 12, 5, 50),
  a('pati2', 'portraits', 'portrety', 'Pati kavárna', null, 4, 1, 60),
  a('pavla_rafael', 'couples', 'parove-foceni', 'Pavla & Rafael', null, 11, 1, 10),
  a('helis_tom', 'couples', 'parove-foceni', 'Helis & Tom', null, 6, 1, 20),
  a('lucka_filip', 'couples', 'parove-foceni', 'Lucka & Filip', 'Brno', 5, 1, 30),
];

/** '<legacyCategory>/<id>/<n>.jpg', the idempotency key of the migration. */
export function legacyKey(legacyCategory: LegacyCategoryKey | string, id: string, n: number): string {
  return `${legacyCategory}/${id}/${n}.jpg`;
}

/** Every legacy key of one album, n = 1..photoCount. */
export function legacyKeysOf(album: LegacyAlbum): string[] {
  return Array.from({ length: album.photoCount }, (_, i) => legacyKey(album.legacyCategory, album.id, i + 1));
}

/** All 141 legacy keys in album order, then file number. */
export function allLegacyKeys(): string[] {
  return LEGACY_ALBUMS.flatMap(legacyKeysOf);
}
