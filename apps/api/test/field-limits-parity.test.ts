import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALBUM_SEO_DESCRIPTION_DB_MAX,
  ALBUM_SEO_DESCRIPTION_MAX,
  ALBUM_SEO_TITLE_DB_MAX,
  ALBUM_SEO_TITLE_MAX,
  ALBUM_TITLE_MAX,
  ALT_MAX,
  CAPTION_MAX,
  CATEGORY_NAME_MAX,
  CATEGORY_SEO_DESCRIPTION_MAX,
  CATEGORY_SEO_TITLE_MAX,
} from '@mp/shared';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase/migrations/20261019100100_catalog.sql'),
  'utf8',
);

/** The upper bound of `check (char_length(col) <= N)` or `between A and N` of a named constraint. */
function sqlMax(constraint: string): number {
  const m = new RegExp(`constraint ${constraint} check \\(char_length\\(\\w+\\) (?:<= |between \\d+ and )(\\d+)\\)`).exec(sql);
  if (!m) throw new Error(`constraint ${constraint} not found`);
  return Number(m[1]);
}

describe('field length constants equal the SQL check constraints', () => {
  it.each([
    ['categories_name_length', CATEGORY_NAME_MAX],
    ['categories_seo_title_length', CATEGORY_SEO_TITLE_MAX],
    ['categories_seo_description_length', CATEGORY_SEO_DESCRIPTION_MAX],
    ['albums_title_length', ALBUM_TITLE_MAX],
    ['albums_seo_title_length', ALBUM_SEO_TITLE_DB_MAX],
    ['albums_seo_description_length', ALBUM_SEO_DESCRIPTION_DB_MAX],
    ['photos_alt_length', ALT_MAX],
    ['photos_caption_length', CAPTION_MAX],
  ])('%s', (constraint, value) => {
    expect(sqlMax(constraint)).toBe(value);
  });

  it('the album SEO editor ceilings never exceed what the database accepts', () => {
    expect(ALBUM_SEO_TITLE_MAX).toBeLessThanOrEqual(ALBUM_SEO_TITLE_DB_MAX);
    expect(ALBUM_SEO_DESCRIPTION_MAX).toBeLessThanOrEqual(ALBUM_SEO_DESCRIPTION_DB_MAX);
  });
});
