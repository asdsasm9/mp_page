/**
 * Instagram planner (WP-14) over PostgREST under the user's JWT: tables ig_posts and ig_post_photos plus the RPC
 * ig_set_post_photos. Planning only, no Instagram call. Posts reference photos by id; a deleted photo disappears
 * from every post (cascade) and the remaining photos keep their sort.
 *
 * Rules (the same in the database and in the fake): caption and hashtags at most 2200 code points; 1..10 distinct
 * photos per post (set only through setPostPhotos; at least one is required); `planned` and `posted` need at least
 * one photo; `posted` only through markPosted. Failures: CatalogError (STALE, NOT_FOUND, INVALID), ApiError
 * (UNAUTHENTICATED, NOT_ADMIN), NetworkError. Planner edits are never site changes: no pending_changes, no change_log.
 */
import type { IgPost, IgProfileRow } from '@mp/shared';
import type { UpdateOptions } from './catalog';

export interface IgPostInput {
  caption?: string;
  hashtags?: string;
  /** YYYY-MM-DD */
  planned_on?: string | null;
  status?: 'draft' | 'planned';
  /** 1..10 photo ids in carousel order; the first is the grid tile. */
  photoIds: readonly string[];
}

/** Status can be set to draft or planned only; posted goes through markPosted. */
export interface IgPostPatch {
  caption?: string;
  hashtags?: string;
  planned_on?: string | null;
  status?: 'draft' | 'planned';
}

/** Typed values of the profile preview (WP-15); every field optional, only given ones change. Limits as in the table. */
export interface IgProfilePatch {
  username?: string;
  display_name?: string;
  bio?: string;
  link?: string;
  followers_count?: number;
  following_count?: number;
  avatar_photo_id?: string | null;
}

export interface PlannerPort {
  /** The single profile row (table ig_profile, seeded by the migration). */
  getProfile(): Promise<IgProfileRow>;
  /**
   * PATCH of the one row. STALE when `options.expectedUpdatedAt` no longer matches; INVALID for a value the table
   * refuses or an avatar photo that does not exist. Not a site change: no pending_changes, no change_log.
   */
  updateProfile(patch: IgProfilePatch, options?: UpdateOptions): Promise<IgProfileRow>;
  /** Profile order: planned and draft by sort ascending, then posted by posted_at descending. Photos in carousel order. */
  listPosts(): Promise<IgPost[]>;
  /** New post at the top (sort = lowest sort - 10), then its photos; when that fails the new post is removed again. */
  createPost(input: IgPostInput): Promise<IgPost>;
  updatePost(id: string, patch: IgPostPatch, options?: UpdateOptions): Promise<IgPost>;
  /** Atomic replace of the photo set (RPC ig_set_post_photos); the order of `photoIds` becomes position 1..n. */
  setPostPhotos(id: string, photoIds: readonly string[]): Promise<void>;
  /** Saves the new sort of the given posts, one PATCH per row. */
  reorderPosts(order: readonly { id: string; sort: number }[]): Promise<void>;
  /** status posted, posted_at as given (ISO); keeps sort. Refused (INVALID) while the post has no photos. */
  markPosted(id: string, postedAt: string, options?: UpdateOptions): Promise<IgPost>;
  /** Back to planned: posted_at null, sort after the last open post. Refused (INVALID) when the post is not posted. */
  unmarkPosted(id: string, options?: UpdateOptions): Promise<IgPost>;
  /** Never deletes a photo. */
  deletePost(id: string): Promise<void>;
}
