/**
 * Album data fields (ADMIN-UX 3.4): normalisation and validation, pure. The limits follow docs/SEO.md for
 * the two search-engine texts (hard ceilings: title 65, description 160 characters) and the database
 * constraints for the rest (title 1 to 120, address 2 to 60).
 */
import type { AlbumRow } from '@mp/shared';
import {
  ALBUM_PLACE_MAX,
  ALBUM_SEO_DESCRIPTION_MAX,
  ALBUM_SEO_TITLE_MAX,
  ALBUM_TITLE_MAX,
  SLUG_MAX,
  isValidSlug,
} from '@mp/shared';

export const ALBUM_FIELDS = ['title', 'place', 'shot_on', 'description', 'slug', 'seo_title', 'seo_description'] as const;
export type AlbumField = (typeof ALBUM_FIELDS)[number];

export const ALBUM_LIMITS = {
  title: ALBUM_TITLE_MAX,
  place: ALBUM_PLACE_MAX,
  slug: SLUG_MAX,
  seoTitle: ALBUM_SEO_TITLE_MAX,
  seoDescription: ALBUM_SEO_DESCRIPTION_MAX,
} as const;

export type FieldProblem =
  | 'titleRequired'
  | 'titleTooLong'
  | 'placeTooLong'
  | 'shotOnInvalid'
  | 'slugRequired'
  | 'slugInvalid'
  | 'slugTaken'
  | 'seoTitleTooLong'
  | 'seoDescriptionTooLong';

/** The text an input shows for a stored value (null shows as empty). */
export function fieldText(album: Pick<AlbumRow, AlbumField>, key: AlbumField): string {
  return album[key] ?? '';
}

/** The value to store for an input text: trimmed; title and address stay strings, the others become null when empty. */
export function normalizeField(key: AlbumField, text: string): string | null {
  const trimmed = text.trim();
  if (key === 'title' || key === 'slug') return trimmed;
  return trimmed === '' ? null : trimmed;
}

/** "2026-02-30" is not a date even though it has the right shape. */
export function isValidShotOn(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export interface ValidationContext {
  /** The addresses of the other albums. */
  takenSlugs: Iterable<string>;
  /** The address the album has now (an old address with an underscore stays acceptable while unchanged). */
  currentSlug: string;
}

/** The problem with an input text, or null when it can be saved. */
export function validateField(key: AlbumField, text: string, context: ValidationContext): FieldProblem | null {
  const value = normalizeField(key, text);
  switch (key) {
    case 'title':
      if (value === '') return 'titleRequired';
      return (value?.length ?? 0) > ALBUM_LIMITS.title ? 'titleTooLong' : null;
    case 'place':
      return (value?.length ?? 0) > ALBUM_LIMITS.place ? 'placeTooLong' : null;
    case 'shot_on':
      return value === null || isValidShotOn(value) ? null : 'shotOnInvalid';
    case 'slug': {
      if (value === '') return 'slugRequired';
      if (value === context.currentSlug) return null;
      if (!isValidSlug(value ?? '')) return 'slugInvalid';
      return new Set(context.takenSlugs).has(value ?? '') ? 'slugTaken' : null;
    }
    case 'seo_title':
      return (value?.length ?? 0) > ALBUM_LIMITS.seoTitle ? 'seoTitleTooLong' : null;
    case 'seo_description':
      return (value?.length ?? 0) > ALBUM_LIMITS.seoDescription ? 'seoDescriptionTooLong' : null;
    case 'description':
      return null;
  }
}
