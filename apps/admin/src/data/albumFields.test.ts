import { describe, expect, it } from 'vitest';
import { ALBUM_LIMITS, isValidShotOn, normalizeField, validateField } from './albumFields';
import { albumStatus } from './albumStatus';
import { formatShotOn } from '../i18n/format';

const ctx = { takenSlugs: ['svatba-1', 'portret'], currentSlug: 'novakovi' };

describe('limits (docs/SEO.md hard ceilings)', () => {
  it('uses 65 characters for the SEO title and 160 for the SEO description', () => {
    expect(ALBUM_LIMITS.seoTitle).toBe(65);
    expect(ALBUM_LIMITS.seoDescription).toBe(160);
  });

  it('accepts the ceiling and refuses one more character', () => {
    expect(validateField('seo_title', 'x'.repeat(65), ctx)).toBeNull();
    expect(validateField('seo_title', 'x'.repeat(66), ctx)).toBe('seoTitleTooLong');
    expect(validateField('seo_description', 'x'.repeat(160), ctx)).toBeNull();
    expect(validateField('seo_description', 'x'.repeat(161), ctx)).toBe('seoDescriptionTooLong');
  });

  it('counts the trimmed text', () => {
    expect(validateField('seo_title', `  ${'x'.repeat(65)}  `, ctx)).toBeNull();
  });
});

describe('title, place and description', () => {
  it('requires a title and caps it at 120', () => {
    expect(validateField('title', '   ', ctx)).toBe('titleRequired');
    expect(validateField('title', 'a'.repeat(121), ctx)).toBe('titleTooLong');
    expect(validateField('title', 'Novákovi', ctx)).toBeNull();
  });

  it('stores empty optional texts as null and trims the rest', () => {
    expect(normalizeField('place', '  ')).toBeNull();
    expect(normalizeField('place', ' Brno ')).toBe('Brno');
    expect(normalizeField('description', '')).toBeNull();
    expect(normalizeField('title', ' Album ')).toBe('Album');
  });
});

describe('shot_on', () => {
  it('accepts real calendar dates in YYYY-MM-DD only', () => {
    expect(isValidShotOn('2026-06-14')).toBe(true);
    expect(isValidShotOn('2024-02-29')).toBe(true);
    expect(isValidShotOn('2026-02-30')).toBe(false);
    expect(isValidShotOn('2026-13-01')).toBe(false);
    expect(isValidShotOn('14.6.2026')).toBe(false);
    expect(isValidShotOn('2026-6-4')).toBe(false);
  });

  it('empty is fine (no date), a bad shape is not', () => {
    expect(validateField('shot_on', '', ctx)).toBeNull();
    expect(validateField('shot_on', '2026-06-14', ctx)).toBeNull();
    expect(validateField('shot_on', 'junior', ctx)).toBe('shotOnInvalid');
    expect(normalizeField('shot_on', '')).toBeNull();
  });

  it('is shown as a Czech date without time zones', () => {
    expect(formatShotOn('2026-06-04')).toBe('4. 6. 2026');
    expect(formatShotOn('nonsense')).toBe('nonsense');
  });
});

describe('slug', () => {
  it('needs lowercase ASCII words with hyphens, 2 to 60 characters', () => {
    expect(validateField('slug', '', ctx)).toBe('slugRequired');
    expect(validateField('slug', 'a', ctx)).toBe('slugInvalid');
    expect(validateField('slug', 'Nove-album', ctx)).toBe('slugInvalid');
    expect(validateField('slug', 'nové', ctx)).toBe('slugInvalid');
    expect(validateField('slug', 'x'.repeat(61), ctx)).toBe('slugInvalid');
    expect(validateField('slug', 'nove-album', ctx)).toBeNull();
  });

  it('refuses an address another album uses', () => {
    expect(validateField('slug', 'svatba-1', ctx)).toBe('slugTaken');
  });

  it('keeps an unchanged old address valid even if it would not pass today', () => {
    expect(validateField('slug', 'stara_adresa', { takenSlugs: [], currentSlug: 'stara_adresa' })).toBeNull();
    expect(validateField('slug', 'stara_adresa', ctx)).toBe('slugInvalid');
  });
});

describe('album status', () => {
  it('has exactly two states: published or unpublished', () => {
    expect(albumStatus({ published: true })).toBe('published');
    expect(albumStatus({ published: false })).toBe('unpublished');
  });
});
