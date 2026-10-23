/**
 * Data for the home page, kept pure so it can be tested without a build: category cards (the category's
 * chosen photo, else the cover of the first album) and reviews (cover of the album the review belongs to). A review whose album is missing
 * from the snapshot, or has no photo, is dropped, so a snapshot without `anez` still builds.
 */
import { effectiveAlt, type SnapshotPhoto } from '@mp/shared';
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
  photo: SnapshotPhoto;
  alt: string;
  /** Name of the category the review's album belongs to (the name line reads `Name · Category`). */
  categoryName: string;
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
      categoryName: entry.category.name,
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
