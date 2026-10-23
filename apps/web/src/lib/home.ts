/**
 * Data for the home page, kept pure so it can be tested without a build: category cards (the category's
 * chosen photo, else the cover of the first album) and reviews (no photos; the album only gives the category name,
 * and a review whose album is missing from the snapshot is kept without one).
 */
import type { SnapshotPhoto } from '@mp/shared';
import type { Review } from '../content/reviews';
import type { Catalog } from './catalog';
import { ogImage } from './images';
import { plural, type PluralForms } from './plural';

const ALBUMS: PluralForms = { one: 'album', few: 'alba', many: 'alb' };

export interface HomeCategoryCard {
  slug: string;
  name: string;
  path: string;
  photo: SnapshotPhoto;
  /** `3 alba`: the meta kicker of the category card (albums that have a published page). */
  countLabel: string;
}

export interface HomeReview {
  review: Review;
  /** Name of the category the review's album belongs to (the name line reads `Name · Category`), or null. */
  categoryName: string | null;
}

export interface HomeHero {
  photo: SnapshotPhoto;
  /** The photo's own alt text, else the fixed hero text. */
  alt: string;
  /** Absolute URL of the photo's og.jpg with its stored size (for og:image). */
  og: { url: string; width: number; height: number };
}

/** The photo chosen for the hero in the admin, or null: the page then uses the bundled main.jpg. */
export function homeHero(catalog: Catalog, fallbackAlt: string, imgBase: string): HomeHero | null {
  const photo = catalog.heroPhoto();
  if (!photo) return null;
  const { url, width, height } = ogImage(photo, imgBase);
  return { photo, alt: photo.alt?.trim() || fallbackAlt, og: { url, width, height } };
}

export function homeCategoryCards(catalog: Catalog): HomeCategoryCard[] {
  const cards: HomeCategoryCard[] = [];
  for (const category of catalog.categories) {
    const photo = catalog.categoryCover(category);
    if (!photo) continue;
    // The card image is decorative (alt=""): the link text is the category name.
    cards.push({
      slug: category.slug,
      name: category.name,
      path: `/${category.slug}/`,
      photo,
      countLabel: plural(category.albums.length, ALBUMS),
    });
  }
  return cards;
}

/** Every review is kept; the album only supplies the category name (null when the album is not in the snapshot). */
export function homeReviews(catalog: Catalog, reviews: readonly Review[]): HomeReview[] {
  return reviews.map((review) => ({
    review,
    categoryName: catalog.albumBySlug.get(review.albumId)?.category.name ?? null,
  }));
}
