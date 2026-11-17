/**
 * Instagram planner (WP-14): constants, zod row schemas and pure helpers. The caption and hashtag limits equal the
 * SQL checks in 20261116100000_ig_planner.sql. Length is counted in Unicode code points (Postgres char_length).
 */
import { z } from 'zod';
import { isValidIgAvatarKey, isValidPhotoId } from './keys';

export const IG_CAPTION_MAX = 2200;
export const IG_HASHTAGS_MAX = 2200;
export const IG_PHOTOS_MAX = 10;
/** Instagram allows 30 hashtags; only a UI count and warning, the database does not check it. */
export const IG_HASHTAGS_COUNT_MAX = 30;
export const IG_STATUSES = ['draft', 'planned', 'posted'] as const;
export type IgStatus = (typeof IG_STATUSES)[number];

const uuid = z.string().refine(isValidPhotoId, 'INVALID_ID');
const isoDateTime = z.iso.datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Length in code points, the way the database counts (an emoji is one, not two UTF-16 units). */
export function captionLength(text: string): number {
  return Array.from(text).length;
}

export const IgPostRowSchema = z.object({
  id: uuid,
  caption: z.string().refine((s) => captionLength(s) <= IG_CAPTION_MAX, 'CAPTION_TOO_LONG'),
  hashtags: z.string().refine((s) => captionLength(s) <= IG_HASHTAGS_MAX, 'HASHTAGS_TOO_LONG'),
  planned_on: isoDate.nullable(),
  status: z.enum(IG_STATUSES),
  posted_at: isoDateTime.nullable(),
  sort: z.number().int(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
});
export type IgPostRow = z.infer<typeof IgPostRowSchema>;

export const IgPostPhotoRowSchema = z.object({
  post_id: uuid,
  photo_id: uuid,
  sort: z.number().int().min(1).max(IG_PHOTOS_MAX),
});
export type IgPostPhotoRow = z.infer<typeof IgPostPhotoRowSchema>;

/** A post with its photos in carousel order (the PostgREST embed `ig_post_photos(photo_id,sort)`). Position 1 is the grid tile. */
export const IgPostSchema = IgPostRowSchema.extend({
  photos: z.array(IgPostPhotoRowSchema.pick({ photo_id: true, sort: true })),
});
export type IgPost = z.infer<typeof IgPostSchema>;

/*
 * Instagram profile preview (WP-15): one typed row (table ig_profile, migration 20261117090000_ig_profile.sql). The
 * limits equal the SQL checks; all values are typed by hand, nothing is fetched from Instagram.
 */
export const IG_USERNAME_MAX = 30;
export const IG_NAME_MAX = 64;
export const IG_BIO_MAX = 150;
export const IG_LINK_MAX = 200;
export const IG_COUNT_MAX = 999999999;

const igText = (max: number, code: string) => z.string().refine((s) => captionLength(s) <= max, code);
const igCount = z.number().int().min(0).max(IG_COUNT_MAX);

export const IgProfileRowSchema = z.object({
  id: z.literal(true),
  username: igText(IG_USERNAME_MAX, 'USERNAME_TOO_LONG').refine((s) => /^[A-Za-z0-9._]*$/.test(s), 'USERNAME_INVALID'),
  display_name: igText(IG_NAME_MAX, 'NAME_TOO_LONG'),
  bio: igText(IG_BIO_MAX, 'BIO_TOO_LONG'),
  link: igText(IG_LINK_MAX, 'LINK_TOO_LONG').refine((s) => s === '' || /^https?:\/\//i.test(s), 'LINK_INVALID'),
  followers_count: igCount,
  following_count: igCount,
  avatar_key: z.string().refine(isValidIgAvatarKey, 'INVALID_AVATAR_KEY').nullable(),
  updated_at: isoDateTime,
});
export type IgProfileRow = z.infer<typeof IgProfileRowSchema>;

/** What the preview shows when the profile cannot be loaded; equals the seed row of the migration. */
export const defaultIgProfile: Omit<IgProfileRow, 'updated_at'> = {
  id: true,
  username: 'mullnyphotos',
  display_name: 'Mullny Photos',
  bio: '',
  link: '',
  followers_count: 0,
  following_count: 0,
  avatar_key: null,
};

/** Avatar fallback: first letters of up to two words of the display name, else of the username, else "?". */
export function profileInitials(profile: { display_name: string; username: string }): string {
  const letter = (word: string) => Array.from(word).find((c) => /[\p{L}\p{N}]/u.test(c));
  const fromName = profile.display_name
    .split(/\s+/)
    .map(letter)
    .filter((c): c is string => c !== undefined)
    .slice(0, 2);
  if (fromName.length > 0) return fromName.join('').toUpperCase();
  return (letter(profile.username) ?? '?').toUpperCase();
}

/**
 * Count the way the Czech Instagram profile shows it: up to 9 999 in full (non-breaking space as thousands separator),
 * then one truncated decimal with "tis." / "mil." / "mld.". Hand-written: Intl cs compact rounds (1 234 becomes
 * "1,2 tis." and 999 999 becomes "1 mil.") and differs between ICU versions.
 */
export function formatProfileCount(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  if (v < 10000) return v >= 1000 ? `${Math.floor(v / 1000)} ${String(v % 1000).padStart(3, '0')}` : String(v);
  const [unit, label] = v < 1e6 ? [1e3, 'tis.'] : v < 1e9 ? [1e6, 'mil.'] : [1e9, 'mld.'];
  const tenths = Math.floor(v / (unit / 10));
  const whole = Math.floor(tenths / 10);
  const dec = tenths % 10;
  return `${dec === 0 ? whole : `${whole},${dec}`} ${label}`;
}

export const IG_FILTERS = ['all', 'posted', 'planned'] as const;
export type IgFilter = (typeof IG_FILTERS)[number];

/** Preview filter: all, only posted, or everything not yet posted (planned and drafts). Order is kept. */
export function filterPosts<T extends { status: IgStatus }>(posts: readonly T[], filter: IgFilter): T[] {
  if (filter === 'posted') return posts.filter((p) => p.status === 'posted');
  if (filter === 'planned') return posts.filter((p) => p.status !== 'posted');
  return [...posts];
}

/** A planned post whose photos were all deleted is shown (and treated) as a draft. */
export function effectiveStatus(post: { status: IgStatus; photos: readonly unknown[] }): IgStatus {
  return post.status === 'planned' && post.photos.length === 0 ? 'draft' : post.status;
}

/** Number of hashtags in the text: words that start with # followed by letters, digits or underscore. */
export function countHashtags(text: string): number {
  return text.match(/(?<![\p{L}\p{N}_#])#[\p{L}\p{N}_]+/gu)?.length ?? 0;
}

/** What is pasted into Instagram: caption, a blank line, hashtags (empty parts are left out). */
export function postedText(post: { caption: string; hashtags: string }): string {
  return [post.caption.trim(), post.hashtags.trim()].filter((part) => part !== '').join('\n\n');
}

/**
 * Profile order, row-major: planned and draft by sort ascending (then id), then posted by posted_at descending.
 * Photos of each post are returned in carousel order.
 */
export function orderPosts<T extends Pick<IgPost, 'id' | 'status' | 'sort' | 'posted_at'>>(posts: readonly T[]): T[] {
  const byId = (a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const open = posts.filter((p) => p.status !== 'posted').sort((a, b) => a.sort - b.sort || byId(a, b));
  const posted = posts
    .filter((p) => p.status === 'posted')
    .sort((a, b) => Date.parse(b.posted_at ?? '') - Date.parse(a.posted_at ?? '') || byId(a, b));
  return [...open, ...posted];
}
