/**
 * Fake planner: ig_posts, ig_post_photos and the RPC ig_set_post_photos of supabase/migrations in memory, with the
 * same rules (status, 2200 code points, 1..10 distinct existing photos, posted needs posted_at) and the same cascade
 * (deleting a photo removes it from every post, see fake/api.ts deletePhotos). Not tracked: no pending_changes and
 * no change_log, like the real tables.
 */
import {
  IG_CAPTION_MAX,
  IG_HASHTAGS_MAX,
  IG_PHOTOS_MAX,
  IgProfileRowSchema,
  captionLength,
  orderPosts,
  type IgPost,
  type IgPostRow,
  type IgProfileRow,
} from '@mp/shared';
import { CatalogError, type PlannerPort } from '../../ports';
import { copy, type Core } from './core';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function createFakePlanner(core: Core): PlannerPort {
  const { state } = core;
  const guard = (op: Parameters<Core['guard']>[0]) => core.guard(op, { auth: true });

  const photosOf = (postId: string) =>
    state.igPostPhotos
      .filter((l) => l.post_id === postId)
      .sort((a, b) => a.sort - b.sort)
      .map((l) => ({ photo_id: l.photo_id, sort: l.sort }));
  const toPost = (row: IgPostRow): IgPost => ({ ...row, photos: photosOf(row.id) });
  const get = (id: string): IgPostRow => {
    const row = state.igPosts.get(id);
    if (!row) throw new CatalogError('NOT_FOUND');
    return row;
  };
  const stale = (row: IgPostRow, expected?: string) => {
    if (expected !== undefined && row.updated_at !== expected) throw new CatalogError('STALE');
  };

  /** The table checks: status, lengths, posted_at matches status, date format. */
  function check(row: IgPostRow): void {
    if (!['draft', 'planned', 'posted'].includes(row.status)) throw new CatalogError('INVALID');
    if (captionLength(row.caption) > IG_CAPTION_MAX || captionLength(row.hashtags) > IG_HASHTAGS_MAX) {
      throw new CatalogError('INVALID');
    }
    if ((row.status === 'posted') !== (row.posted_at !== null)) throw new CatalogError('INVALID');
    if (row.planned_on !== null && (!DATE.test(row.planned_on) || Number.isNaN(Date.parse(row.planned_on)))) {
      throw new CatalogError('INVALID');
    }
    if (row.posted_at !== null && Number.isNaN(Date.parse(row.posted_at))) throw new CatalogError('INVALID');
  }
  /** App rule (the database cannot see it): planned and posted need at least one photo. */
  function needsPhoto(row: IgPostRow): void {
    if (row.status !== 'draft' && photosOf(row.id).length === 0) throw new CatalogError('INVALID');
  }

  /** RPC ig_set_post_photos: the list is checked, then the post, then the photos; all or nothing. */
  function setPhotos(postId: string, photoIds: readonly string[]): void {
    if (photoIds.length < 1 || photoIds.length > IG_PHOTOS_MAX || new Set(photoIds).size !== photoIds.length) {
      throw new CatalogError('INVALID');
    }
    const post = state.igPosts.get(postId);
    if (!post) throw new CatalogError('NOT_FOUND');
    if (photoIds.some((id) => !state.photos.has(id))) throw new CatalogError('NOT_FOUND');
    state.igPostPhotos = state.igPostPhotos.filter((l) => l.post_id !== postId);
    photoIds.forEach((photo_id, i) => state.igPostPhotos.push({ post_id: postId, photo_id, sort: i + 1 }));
    post.updated_at = core.stamp(post.updated_at);
  }

  function remove(id: string): void {
    state.igPosts.delete(id);
    state.igPostPhotos = state.igPostPhotos.filter((l) => l.post_id !== id);
  }

  return {
    async getProfile() {
      guard('planner.getProfile');
      return copy(state.igProfile);
    },
    async updateProfile(patch, options = {}) {
      guard('planner.updateProfile');
      const row = state.igProfile;
      if (options.expectedUpdatedAt !== undefined && row.updated_at !== options.expectedUpdatedAt) {
        throw new CatalogError('STALE');
      }
      // Column grant: only the typed columns can change (id and updated_at never); unknown keys are refused.
      const allowed = ['username', 'display_name', 'bio', 'link', 'followers_count', 'following_count', 'avatar_photo_id'];
      if (Object.keys(patch).some((k) => !allowed.includes(k))) throw new CatalogError('INVALID');
      const merged = { ...row, ...patch };
      // The table checks, via the same schema the real adapter parses with.
      if (!IgProfileRowSchema.safeParse(merged).success) throw new CatalogError('INVALID');
      if (merged.avatar_photo_id !== null && !state.photos.has(merged.avatar_photo_id)) throw new CatalogError('INVALID');
      const next: IgProfileRow = { ...merged, updated_at: core.stamp(row.updated_at) };
      state.igProfile = next;
      return copy(next);
    },
    async listPosts() {
      guard('planner.listPosts');
      return copy(orderPosts([...state.igPosts.values()].map(toPost)));
    },
    async createPost(input) {
      guard('planner.createPost');
      const now = core.iso();
      const sorts = [...state.igPosts.values()].map((p) => p.sort);
      const row: IgPostRow = {
        id: core.ids.uuid(),
        caption: input.caption ?? '',
        hashtags: input.hashtags ?? '',
        planned_on: input.planned_on ?? null,
        status: input.status ?? 'draft',
        posted_at: null,
        sort: sorts.length === 0 ? 0 : Math.min(...sorts) - 10,
        created_at: now,
        updated_at: now,
      };
      check(row);
      state.igPosts.set(row.id, row);
      try {
        setPhotos(row.id, input.photoIds);
      } catch (error) {
        remove(row.id);
        throw error;
      }
      return copy(toPost(row));
    },
    async updatePost(id, patch, options = {}) {
      guard('planner.updatePost');
      const row = get(id);
      stale(row, options.expectedUpdatedAt);
      const next: IgPostRow = { ...row, ...patch, id: row.id, posted_at: row.posted_at, sort: row.sort };
      check(next);
      // Only when the status is set: a caption edit of a broken (photo-less) planned post stays possible.
      if (patch.status !== undefined) needsPhoto(next);
      next.updated_at = core.stamp(row.updated_at);
      state.igPosts.set(id, next);
      return copy(toPost(next));
    },
    async setPostPhotos(id, photoIds) {
      guard('planner.setPostPhotos');
      setPhotos(id, photoIds);
    },
    async reorderPosts(order) {
      guard('planner.reorderPosts');
      const rows = order.map((o) => get(o.id));
      rows.forEach((row, i) => {
        row.sort = order[i]!.sort;
        row.updated_at = core.stamp(row.updated_at);
      });
    },
    async markPosted(id, postedAt, options = {}) {
      guard('planner.markPosted');
      const row = get(id);
      stale(row, options.expectedUpdatedAt);
      const next: IgPostRow = { ...row, status: 'posted', posted_at: postedAt };
      check(next);
      needsPhoto(next);
      next.updated_at = core.stamp(row.updated_at);
      state.igPosts.set(id, next);
      return copy(toPost(next));
    },
    async unmarkPosted(id, options = {}) {
      guard('planner.unmarkPosted');
      const row = get(id);
      stale(row, options.expectedUpdatedAt);
      if (row.status !== 'posted') throw new CatalogError('INVALID');
      const open = [...state.igPosts.values()].filter((p) => p.status !== 'posted');
      const next: IgPostRow = {
        ...row,
        status: 'planned',
        posted_at: null,
        sort: open.length === 0 ? 0 : Math.max(...open.map((p) => p.sort)) + 10,
      };
      check(next);
      next.updated_at = core.stamp(row.updated_at);
      state.igPosts.set(id, next);
      return copy(toPost(next));
    },
    async deletePost(id) {
      guard('planner.deletePost');
      remove(id);
    },
  };
}

/**
 * Example posts for the browser checks and screen tests, built from the photos of the seeded catalog: drafts,
 * planned posts, a planned post whose only photo was deleted, posted posts (one carousel, one that lost a photo).
 * Sort ascending is the grid order; the post to publish next is the last open one.
 */
export function seedPlanner(core: Core): void {
  const { state } = core;
  const photoIds = [...state.photos.keys()];
  if (photoIds.length === 0) return;
  let cursor = 0;
  const take = (n: number): string[] => {
    const count = Math.min(n, photoIds.length);
    const picked = Array.from({ length: count }, (_, i) => photoIds[(cursor + i) % photoIds.length]!);
    cursor += count;
    return picked;
  };
  const day = 86_400_000;
  const add = (
    caption: string,
    status: IgPostRow['status'],
    sort: number,
    photos: { ids: string[]; sorts?: number[] },
    extra: Partial<Pick<IgPostRow, 'planned_on' | 'posted_at' | 'hashtags'>> = {},
  ) => {
    const stamp = new Date(core.clock.now() - 30 * day).toISOString();
    const row: IgPostRow = {
      id: core.ids.uuid(),
      caption,
      hashtags: extra.hashtags ?? '#svatba #fotografka #brno',
      planned_on: extra.planned_on ?? null,
      status,
      posted_at: extra.posted_at ?? null,
      sort,
      created_at: stamp,
      updated_at: stamp,
    };
    state.igPosts.set(row.id, row);
    photos.ids.forEach((photo_id, i) =>
      state.igPostPhotos.push({ post_id: row.id, photo_id, sort: photos.sorts?.[i] ?? i + 1 }),
    );
  };
  const at = (daysAgo: number) => new Date(core.clock.now() - daysAgo * day).toISOString();

  add('Koncept bez data', 'draft', 10, { ids: take(1) });
  add('Svatba na zámku', 'planned', 20, { ids: take(3) }, { planned_on: '2026-11-20' });
  add('Portrét v ateliéru', 'planned', 30, { ids: take(1) }, { planned_on: '2026-11-25' });
  add('Rozepsaný příspěvek', 'draft', 40, { ids: take(2) }, { hashtags: '' });
  add('Fotka byla smazána', 'planned', 50, { ids: [] });
  add('Podzimní páry', 'posted', 0, { ids: take(1) }, { posted_at: at(10) });
  add('Svatební den', 'posted', 0, { ids: take(4) }, { posted_at: at(20) });
  add('Zbyla jedna z tří', 'posted', 0, { ids: take(1), sorts: [3] }, { posted_at: at(30) });
  add('Starší příspěvek', 'posted', 0, { ids: take(2) }, { posted_at: at(60), hashtags: '' });
}
