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
  IG_BIO_MAX,
  IG_CAPTION_MAX,
  IG_COUNT_MAX,
  IG_HASHTAGS_MAX,
  IG_LINK_MAX,
  IG_NAME_MAX,
  IG_PHOTOS_MAX,
  IG_STATUSES,
  IG_USERNAME_MAX,
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

const igSql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase/migrations/20261116100000_ig_planner.sql'),
  'utf8',
);

describe('Instagram planner constants equal the SQL check constraints', () => {
  const igMax = (constraint: string) => {
    const m = new RegExp(`constraint ${constraint} check \\(char_length\\(\\w+\\) <= (\\d+)\\)`).exec(igSql);
    if (!m) throw new Error(`constraint ${constraint} not found`);
    return Number(m[1]);
  };

  it('caption and hashtags', () => {
    expect(igMax('ig_posts_caption_length')).toBe(IG_CAPTION_MAX);
    expect(igMax('ig_posts_hashtags_length')).toBe(IG_HASHTAGS_MAX);
  });

  it('photos per post and statuses', () => {
    expect(igSql).toContain(`check (sort between 1 and ${IG_PHOTOS_MAX})`);
    const m = /constraint ig_posts_status check \(status in \(([^)]*)\)\)/.exec(igSql);
    expect(m).not.toBeNull();
    expect(m![1]!.split(',').map((s) => s.trim().replace(/'/g, ''))).toEqual([...IG_STATUSES]);
  });
});

const igProfileSql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase/migrations/20261117090000_ig_profile.sql'),
  'utf8',
);

describe('Instagram profile constants equal the SQL check constraints', () => {
  const profileMax = (constraint: string) => {
    const m = new RegExp(`constraint ${constraint} check \\(char_length\\(\\w+\\) <= (\\d+)\\)`).exec(igProfileSql);
    if (!m) throw new Error(`constraint ${constraint} not found`);
    return Number(m[1]);
  };

  it('username, name, bio and link lengths', () => {
    expect(profileMax('ig_profile_username_length')).toBe(IG_USERNAME_MAX);
    expect(profileMax('ig_profile_name_length')).toBe(IG_NAME_MAX);
    expect(profileMax('ig_profile_bio_length')).toBe(IG_BIO_MAX);
    expect(profileMax('ig_profile_link_length')).toBe(IG_LINK_MAX);
  });

  it('count ranges', () => {
    for (const c of ['ig_profile_followers_range', 'ig_profile_following_range']) {
      const m = new RegExp(`constraint ${c} check \\(\\w+ between 0 and (\\d+)\\)`).exec(igProfileSql);
      expect(m, c).not.toBeNull();
      expect(Number(m![1])).toBe(IG_COUNT_MAX);
    }
  });

  it('username characters and link scheme', () => {
    expect(igProfileSql).toContain(`check (username ~ '^[A-Za-z0-9._]*$')`);
    expect(igProfileSql).toContain(`check (link = '' or link ~* '^https?://')`);
  });
});

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
