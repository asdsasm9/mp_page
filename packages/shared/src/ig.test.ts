import { describe, expect, it } from 'vitest';
import {
  IG_BIO_MAX,
  IG_CAPTION_MAX,
  IG_COUNT_MAX,
  IG_FILTERS,
  IG_LINK_MAX,
  IG_NAME_MAX,
  IG_USERNAME_MAX,
  IgPostPhotoRowSchema,
  IgProfileRowSchema,
  defaultIgProfile,
  filterPosts,
  formatProfileCount,
  profileInitials,
  IgPostRowSchema,
  IgPostSchema,
  captionLength,
  countHashtags,
  effectiveStatus,
  orderPosts,
  postedText,
} from './ig';

const ID = 'dddddddd-0000-4000-8000-000000000001';
const ID2 = 'dddddddd-0000-4000-8000-000000000002';
const AT = '2026-11-16T10:00:00.123456+00:00';

const row = {
  id: ID,
  caption: 'Ahoj',
  hashtags: '#svatba',
  planned_on: null,
  status: 'draft',
  posted_at: null,
  sort: 0,
  created_at: AT,
  updated_at: AT,
};

describe('captionLength', () => {
  it('counts code points, not UTF-16 units', () => {
    expect(captionLength('')).toBe(0);
    expect(captionLength('abc')).toBe(3);
    expect(captionLength('😀')).toBe(1);
    expect(captionLength('a😀č')).toBe(3);
  });
});

describe('countHashtags', () => {
  it('counts hashtags incl. Czech letters and digits', () => {
    expect(countHashtags('')).toBe(0);
    expect(countHashtags('#svatba #brno2026 #ženich_nevěsta')).toBe(3);
    expect(countHashtags('#a#b')).toBe(1);
    expect(countHashtags('bez# hashtagu # a mail@x.cz a#b')).toBe(0);
    expect(countHashtags('text\n#a\n#b')).toBe(2);
  });
});

describe('postedText', () => {
  it('joins caption and hashtags with a blank line and leaves out empty parts', () => {
    expect(postedText({ caption: 'Ahoj', hashtags: '#a #b' })).toBe('Ahoj\n\n#a #b');
    expect(postedText({ caption: 'Ahoj', hashtags: '' })).toBe('Ahoj');
    expect(postedText({ caption: '  ', hashtags: ' #a ' })).toBe('#a');
    expect(postedText({ caption: '', hashtags: '' })).toBe('');
  });
});

describe('effectiveStatus', () => {
  it('turns a planned post without photos into a draft only', () => {
    expect(effectiveStatus({ status: 'planned', photos: [] })).toBe('draft');
    expect(effectiveStatus({ status: 'planned', photos: [{}] })).toBe('planned');
    expect(effectiveStatus({ status: 'draft', photos: [] })).toBe('draft');
    expect(effectiveStatus({ status: 'posted', photos: [] })).toBe('posted');
  });
});

describe('schemas', () => {
  it('accepts a PostgREST row and a post with embedded photos', () => {
    expect(IgPostRowSchema.parse(row)).toEqual(row);
    const post = IgPostSchema.parse({ ...row, photos: [{ photo_id: ID2, sort: 1 }] });
    expect(post.photos).toHaveLength(1);
  });
  it('rejects bad status, 2201 code points, bad date and sort range', () => {
    expect(IgPostRowSchema.safeParse({ ...row, status: 'x' }).success).toBe(false);
    expect(IgPostRowSchema.safeParse({ ...row, caption: '😀'.repeat(IG_CAPTION_MAX) }).success).toBe(true);
    expect(IgPostRowSchema.safeParse({ ...row, caption: 'a'.repeat(IG_CAPTION_MAX + 1) }).success).toBe(false);
    expect(IgPostRowSchema.safeParse({ ...row, hashtags: 'a'.repeat(2201) }).success).toBe(false);
    expect(IgPostRowSchema.safeParse({ ...row, planned_on: '16.11.2026' }).success).toBe(false);
    expect(IgPostPhotoRowSchema.safeParse({ post_id: ID, photo_id: ID2, sort: 0 }).success).toBe(false);
    expect(IgPostPhotoRowSchema.safeParse({ post_id: ID, photo_id: ID2, sort: 11 }).success).toBe(false);
    expect(IgPostPhotoRowSchema.safeParse({ post_id: ID, photo_id: 'nope', sort: 1 }).success).toBe(false);
  });
});

const profile = {
  id: true,
  username: 'mullny.photos_1',
  display_name: 'Mullny Photos',
  bio: 'Řádek 1\nŘádek 2',
  link: 'https://example.test/x',
  followers_count: 1234,
  following_count: 0,
  avatar_photo_id: ID2,
  updated_at: AT,
};

describe('IgProfileRowSchema', () => {
  it('exposes the limits of the SQL checks', () => {
    expect([IG_USERNAME_MAX, IG_NAME_MAX, IG_BIO_MAX, IG_LINK_MAX, IG_COUNT_MAX]).toEqual([30, 64, 150, 200, 999999999]);
  });
  it('accepts a row, an empty profile and a null avatar', () => {
    expect(IgProfileRowSchema.parse(profile)).toEqual(profile);
    const empty = { ...profile, username: '', display_name: '', bio: '', link: '', avatar_photo_id: null };
    expect(IgProfileRowSchema.safeParse(empty).success).toBe(true);
  });
  const bad = (patch: Record<string, unknown>) => IgProfileRowSchema.safeParse({ ...profile, ...patch }).success;
  it('username: 30 pass, 31 and bad characters fail', () => {
    expect(bad({ username: 'a'.repeat(30) })).toBe(true);
    expect(bad({ username: 'a'.repeat(31) })).toBe(false);
    for (const u of ['a b', 'čau', 'a-b', 'a@b', 'a\n']) expect(bad({ username: u }), u).toBe(false);
  });
  it('name 64, bio 150 and link 200 code points', () => {
    expect(bad({ display_name: '😀'.repeat(64) })).toBe(true);
    expect(bad({ display_name: 'a'.repeat(65) })).toBe(false);
    expect(bad({ bio: '😀'.repeat(150) })).toBe(true);
    expect(bad({ bio: 'a'.repeat(151) })).toBe(false);
    expect(bad({ link: `https://${'a'.repeat(192)}` })).toBe(true);
    expect(bad({ link: `https://${'a'.repeat(193)}` })).toBe(false);
  });
  it('link is empty or http(s)', () => {
    expect(bad({ link: 'HTTP://x.cz' })).toBe(true);
    for (const l of ['ftp://x.cz', 'x.cz', 'javascript:alert(1)', ' https://x.cz']) expect(bad({ link: l }), l).toBe(false);
  });
  it('counts are integers 0..999999999', () => {
    expect(bad({ followers_count: 999999999, following_count: 0 })).toBe(true);
    for (const c of [-1, 1000000000, 1.5, Number.NaN, '5']) {
      expect(bad({ followers_count: c }), String(c)).toBe(false);
      expect(bad({ following_count: c }), String(c)).toBe(false);
    }
  });
  it('rejects a bad id, avatar id, timestamp and a row id other than true', () => {
    expect(bad({ id: false })).toBe(false);
    expect(bad({ avatar_photo_id: 'nope' })).toBe(false);
    expect(bad({ updated_at: 'yesterday' })).toBe(false);
  });
});

describe('defaultIgProfile', () => {
  it('is valid and has the seed values', () => {
    expect(IgProfileRowSchema.safeParse({ ...defaultIgProfile, updated_at: AT }).success).toBe(true);
    expect(defaultIgProfile).toMatchObject({ display_name: 'Mullny Photos', username: 'mullnyphotos', avatar_photo_id: null });
  });
});

describe('profileInitials', () => {
  it('uses up to two words of the display name', () => {
    expect(profileInitials({ display_name: 'Mullny Photos', username: 'x' })).toBe('MP');
    expect(profileInitials({ display_name: 'adam  jan  novák', username: 'x' })).toBe('AJ');
    expect(profileInitials({ display_name: 'Čapek', username: 'x' })).toBe('Č');
    expect(profileInitials({ display_name: '😀 Foto', username: 'x' })).toBe('F');
  });
  it('falls back to the username, then to a question mark', () => {
    expect(profileInitials({ display_name: '  ', username: '_mullny' })).toBe('M');
    expect(profileInitials({ display_name: '', username: '' })).toBe('?');
    expect(profileInitials({ display_name: '- -', username: '._' })).toBe('?');
  });
});

describe('formatProfileCount', () => {
  it('shows up to 9 999 in full with a non-breaking space', () => {
    expect(formatProfileCount(0)).toBe('0');
    expect(formatProfileCount(999)).toBe('999');
    expect(formatProfileCount(1000)).toBe('1 000');
    expect(formatProfileCount(1234)).toBe('1 234');
    expect(formatProfileCount(9999)).toBe('9 999');
  });
  it('abbreviates from 10 000 with one truncated decimal and Czech units', () => {
    expect(formatProfileCount(10000)).toBe('10 tis.');
    expect(formatProfileCount(12345)).toBe('12,3 tis.');
    expect(formatProfileCount(999999)).toBe('999,9 tis.');
    expect(formatProfileCount(1000000)).toBe('1 mil.');
    expect(formatProfileCount(1250000)).toBe('1,2 mil.');
    expect(formatProfileCount(IG_COUNT_MAX)).toBe('999,9 mil.');
    expect(formatProfileCount(1000000000)).toBe('1 mld.');
  });
  it('treats bad input as zero', () => {
    expect(formatProfileCount(-5)).toBe('0');
    expect(formatProfileCount(Number.NaN)).toBe('0');
    expect(formatProfileCount(12.9)).toBe('12');
  });
});

describe('filterPosts and IG_FILTERS', () => {
  const posts = [
    { id: 'a', status: 'planned' as const },
    { id: 'b', status: 'draft' as const },
    { id: 'c', status: 'posted' as const },
  ];
  it('lists the three filters, all first (the default)', () => {
    expect([...IG_FILTERS]).toEqual(['all', 'posted', 'planned']);
  });
  it('all keeps everything, posted only posted, planned includes drafts, order kept', () => {
    expect(filterPosts(posts, 'all').map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(filterPosts(posts, 'posted').map((p) => p.id)).toEqual(['c']);
    expect(filterPosts(posts, 'planned').map((p) => p.id)).toEqual(['a', 'b']);
    expect(filterPosts([], 'posted')).toEqual([]);
  });
  it('returns a copy for all', () => {
    expect(filterPosts(posts, 'all')).not.toBe(posts);
  });
});

describe('orderPosts', () => {
  it('puts planned and draft by sort first, posted by posted_at descending after', () => {
    const p = (id: string, status: 'draft' | 'planned' | 'posted', sort: number, posted_at: string | null = null) => ({
      id,
      status,
      sort,
      posted_at,
    });
    const ordered = orderPosts([
      p('a', 'posted', 0, '2026-01-01T10:00:00Z'),
      p('b', 'planned', 20),
      p('c', 'posted', 0, '2026-03-01T10:00:00Z'),
      p('d', 'draft', -10),
    ]);
    expect(ordered.map((x) => x.id)).toEqual(['d', 'b', 'c', 'a']);
  });
});
