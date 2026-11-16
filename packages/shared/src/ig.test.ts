import { describe, expect, it } from 'vitest';
import {
  IG_CAPTION_MAX,
  IgPostPhotoRowSchema,
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
