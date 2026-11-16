/**
 * Real PlannerPort: PostgREST under the user's JWT (never a service key) over ig_posts and ig_post_photos, and the
 * RPC ig_set_post_photos for the photo set. Rows are zod-parsed; a body that does not match is ApiError INTERNAL.
 * Updates carry `updated_at=eq.<value read earlier>` like the catalog adapter. The database cannot enforce "planned
 * and posted need a photo" (the RPC replaces the set), so this adapter checks it before the request.
 */
import { IgPostRowSchema, IgPostPhotoRowSchema, orderPosts, type IgPost } from '@mp/shared';
import { z } from 'zod';
import { ApiError, CatalogError, type PlannerPort } from '../../ports';
import type { Rest } from './http';

const EMBED = 'ig_post_photos(photo_id,sort)';
const WITH_PHOTOS = `*,${EMBED}`;

const EmbeddedSchema = IgPostRowSchema.extend({
  ig_post_photos: z.array(IgPostPhotoRowSchema.pick({ photo_id: true, sort: true })),
});

function parsePost(raw: unknown): IgPost {
  const parsed = EmbeddedSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError('INTERNAL');
  const { ig_post_photos, ...row } = parsed.data;
  return { ...row, photos: [...ig_post_photos].sort((a, b) => a.sort - b.sort) };
}

export function createRealPlanner(rest: Rest): PlannerPort {
  async function getPost(id: string): Promise<IgPost | null> {
    const rows = await rest.select<unknown>('ig_posts', { select: WITH_PHOTOS, id: `eq.${id}`, limit: '1' });
    return rows[0] === undefined ? null : parsePost(rows[0]);
  }

  async function hasPhotos(id: string): Promise<boolean> {
    const rows = await rest.select<unknown>('ig_post_photos', { select: 'photo_id', post_id: `eq.${id}`, limit: '1' });
    return rows.length > 0;
  }

  async function update(id: string, patch: unknown, expectedUpdatedAt: string | undefined): Promise<IgPost> {
    const query: Record<string, string> = { id: `eq.${id}`, select: WITH_PHOTOS };
    if (expectedUpdatedAt !== undefined) query.updated_at = `eq.${expectedUpdatedAt}`;
    const rows = await rest.patch<unknown>('ig_posts', query, patch);
    if (rows[0] !== undefined) return parsePost(rows[0]);
    // Nothing matched: tell "changed elsewhere" from "gone".
    const existing = await rest.select<{ id: string }>('ig_posts', { select: 'id', id: `eq.${id}`, limit: '1' });
    throw new CatalogError(existing.length > 0 && expectedUpdatedAt !== undefined ? 'STALE' : 'NOT_FOUND');
  }

  async function extremeSort(filter: Record<string, string>, direction: 'asc' | 'desc'): Promise<number | null> {
    const rows = await rest.select<{ sort: number }>('ig_posts', {
      select: 'sort',
      order: `sort.${direction}`,
      limit: '1',
      ...filter,
    });
    return rows[0]?.sort ?? null;
  }

  async function setPhotos(id: string, photoIds: readonly string[]): Promise<void> {
    await rest.rpc('ig_set_post_photos', { p_post_id: id, p_photo_ids: [...photoIds] });
  }

  return {
    async listPosts() {
      const rows = await rest.select<unknown>('ig_posts', { select: WITH_PHOTOS, order: 'sort.asc,id.asc' });
      return orderPosts(rows.map(parsePost));
    },
    async createPost(input) {
      const lowest = await extremeSort({}, 'asc');
      const rows = await rest.insert<{ id?: unknown }>('ig_posts', {
        caption: input.caption ?? '',
        hashtags: input.hashtags ?? '',
        planned_on: input.planned_on ?? null,
        status: input.status ?? 'draft',
        sort: lowest === null ? 0 : lowest - 10,
      });
      const id = rows[0]?.id;
      if (typeof id !== 'string') throw new CatalogError('INVALID');
      try {
        await setPhotos(id, input.photoIds);
      } catch (error) {
        // Compensation: no post without photos is left behind by a failed create.
        await rest.remove('ig_posts', { id: `eq.${id}` }).catch(() => undefined);
        throw error;
      }
      const post = await getPost(id);
      if (!post) throw new CatalogError('NOT_FOUND');
      return post;
    },
    async updatePost(id, patch, options) {
      if (patch.status === 'planned' && !(await hasPhotos(id))) throw new CatalogError('INVALID');
      return update(id, patch, options?.expectedUpdatedAt);
    },
    setPostPhotos: setPhotos,
    async reorderPosts(order) {
      for (const { id, sort } of order) {
        const rows = await rest.patch<{ id: string }>('ig_posts', { id: `eq.${id}`, select: 'id' }, { sort });
        if (rows.length === 0) throw new CatalogError('NOT_FOUND');
      }
    },
    async markPosted(id, postedAt, options) {
      if (!(await hasPhotos(id))) throw new CatalogError('INVALID');
      return update(id, { status: 'posted', posted_at: postedAt }, options?.expectedUpdatedAt);
    },
    async unmarkPosted(id, options) {
      const post = await getPost(id);
      if (!post) throw new CatalogError('NOT_FOUND');
      if (post.status !== 'posted') throw new CatalogError('INVALID');
      const highest = await extremeSort({ status: 'neq.posted' }, 'desc');
      return update(
        id,
        { status: 'planned', posted_at: null, sort: highest === null ? 0 : highest + 10 },
        options?.expectedUpdatedAt,
      );
    },
    deletePost: (id) => rest.remove('ig_posts', { id: `eq.${id}` }),
  };
}
