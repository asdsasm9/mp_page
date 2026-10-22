/**
 * Selection of albums for /portfolio/ (decision D-6), pure so it can be tested without a build: the first album
 * of every category comes first (so each category is represented), then the remaining albums in catalog order,
 * up to `max`. Every card is lazy: the category cards above them are the first thing on the page.
 */
import type { SnapshotAlbum, SnapshotCategory } from '@mp/shared';
import type { Catalog } from './catalog';
import { albumCard, type CategoryCard } from './category';

export const PORTFOLIO_ALBUMS = 9;

export interface PortfolioPick {
  category: SnapshotCategory;
  album: SnapshotAlbum;
}

export function portfolioPicks(catalog: Catalog, max = PORTFOLIO_ALBUMS): PortfolioPick[] {
  const first: PortfolioPick[] = [];
  const rest: PortfolioPick[] = [];
  for (const category of catalog.categories) {
    category.albums.forEach((album, i) => {
      if (!catalog.coverOf(album)) return;
      (i === 0 || first.every((p) => p.category !== category) ? first : rest).push({ category, album });
    });
  }
  return [...first, ...rest].slice(0, max);
}

export function portfolioCards(catalog: Catalog, max = PORTFOLIO_ALBUMS): CategoryCard[] {
  const cards: CategoryCard[] = [];
  for (const { category, album } of portfolioPicks(catalog, max)) {
    const card = albumCard(catalog, category, album, cards.length, 0);
    if (card) cards.push(card);
  }
  return cards;
}
