/**
 * Data for the home page, kept pure so it can be tested without a build: category cards (cover of the
 * first album) and reviews (cover of the album the review belongs to). A review whose album is missing
 * from the snapshot, or has no photo, is dropped, so a snapshot without `anez` still builds.
 */
import { effectiveAlt, type SnapshotPhoto } from '@mp/shared';
import type { Review } from '../content/reviews';
import type { Catalog } from './catalog';

export interface HomeCategoryCard {
  slug: string;
  name: string;
  path: string;
  photo: SnapshotPhoto;
  alt: string;
}

export interface HomeReview {
  review: Review;
  photo: SnapshotPhoto;
  alt: string;
}

export function homeCategoryCards(catalog: Catalog): HomeCategoryCard[] {
  const cards: HomeCategoryCard[] = [];
  for (const category of catalog.categories) {
    const album = category.albums[0];
    const photo = catalog.categoryCover(category);
    if (!album || !photo) continue;
    const n = album.photos.findIndex((p) => p.id === photo.id) + 1;
    cards.push({
      slug: category.slug,
      name: category.name,
      path: `/${category.slug}/`,
      photo,
      alt: effectiveAlt(photo, { albumTitle: album.title, categoryKey: category.slug, n, total: album.photos.length }),
    });
  }
  return cards;
}

export function homeReviews(catalog: Catalog, reviews: readonly Review[]): HomeReview[] {
  const out: HomeReview[] = [];
  for (const review of reviews) {
    const entry = catalog.albumBySlug.get(review.albumId);
    const photo = entry ? catalog.coverOf(entry.album) : null;
    if (!entry || !photo) continue;
    const n = entry.album.photos.findIndex((p) => p.id === photo.id) + 1;
    out.push({
      review,
      photo,
      alt: effectiveAlt(photo, {
        albumTitle: entry.album.title,
        categoryKey: entry.category.slug,
        n,
        total: entry.album.photos.length,
      }),
    });
  }
  return out;
}
