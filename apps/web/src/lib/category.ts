/**
 * Data for the category pages, pure so it can be tested without a build: which categories get a page and the
 * album cards (cover, title, place, count with the Czech plural). Loading priority follows plan WP-3 4.4:
 * the first row of covers is eager, the very first one also carries fetchpriority="high" (it is the LCP
 * candidate), everything after is lazy.
 */
import type { SnapshotAlbum, SnapshotCategory, SnapshotPhoto } from '@mp/shared';
import type { Catalog } from './catalog';
import { plural, type PluralForms } from './plural';

/** Cards per row at the widest layout (matches the 3-column grid and the `card` sizes context). */
export const FIRST_ROW = 3;

const PHOTOS: PluralForms = { one: 'fotografie', few: 'fotografie', many: 'fotografií' };

export interface CategoryCard {
  slug: string;
  title: string;
  place: string | null;
  path: string;
  photo: SnapshotPhoto;
  /** `12 fotografií`. */
  countLabel: string;
  eager: boolean;
  priority: boolean;
}

/** Slugs that get a page: categories with at least one published album (the catalog already drops empty ones). */
export const categoryPaths = (catalog: Catalog): string[] => catalog.categories.map((c) => c.slug);

/** One album card; `index` is its position on the page (drives eager/priority). Null for an album without photos. */
export function albumCard(
  catalog: Catalog,
  category: Pick<SnapshotCategory, 'slug'>,
  album: SnapshotAlbum,
  index: number,
  eagerRow = FIRST_ROW,
): CategoryCard | null {
  const photo = catalog.coverOf(album);
  if (!photo) return null;
  return {
    slug: album.slug,
    title: album.title,
    place: album.place?.trim() || null,
    path: `/${category.slug}/${album.slug}/`,
    photo,
    countLabel: plural(album.photos.length, PHOTOS),
    eager: index < eagerRow,
    priority: index === 0 && eagerRow > 0,
  };
}

export function categoryCards(catalog: Catalog, category: SnapshotCategory): CategoryCard[] {
  const cards: CategoryCard[] = [];
  for (const album of category.albums as SnapshotAlbum[]) {
    const card = albumCard(catalog, category, album, cards.length);
    if (card) cards.push(card);
  }
  return cards;
}
