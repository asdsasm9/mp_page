/**
 * Instagram planner (WP-14): constants, zod row schemas and pure helpers. The caption and hashtag limits equal the
 * SQL checks in 20261116100000_ig_planner.sql. Length is counted in Unicode code points (Postgres char_length).
 */
import { z } from 'zod';
import { isValidPhotoId } from './keys';

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
