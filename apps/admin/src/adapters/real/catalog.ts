/**
 * Real CatalogPort: PostgREST under the user's JWT. Photos are only read and PATCHed (album_id, sort,
 * alt, caption), never inserted or deleted (decision D-5): rows are created by /uploads/commit and
 * removed by /photos/delete. Updates carry `updated_at=eq.<value read earlier>` as optimistic
 * concurrency: no matching row means somebody else changed it (STALE) or it is gone (NOT_FOUND).
 */
import type { AlbumRow, CategoryRow, PhotoRow, PublishLogRow, SiteStateRow } from '@mp/shared';
import { CatalogError, type CatalogPort } from '../../ports';
import type { Rest } from './http';

const PHOTO_PATCH_COLUMNS: readonly string[] = ['album_id', 'sort', 'alt', 'caption'];
const BY_SORT = 'sort.asc,id.asc';

export function createRealCatalog(rest: Rest): CatalogPort {
  async function getById<T>(table: string, id: string): Promise<T | null> {
    const rows = await rest.select<T>(table, { select: '*', id: `eq.${id}`, limit: '1' });
    return rows[0] ?? null;
  }

  async function create<T>(table: string, body: unknown): Promise<T> {
    const rows = await rest.insert<T>(table, body);
    if (!rows[0]) throw new CatalogError('INVALID');
    return rows[0];
  }

  async function update<T>(
    table: string,
    id: string,
    patch: unknown,
    expectedUpdatedAt: string | undefined,
  ): Promise<T> {
    const query: Record<string, string> = { id: `eq.${id}` };
    if (expectedUpdatedAt !== undefined) query.updated_at = `eq.${expectedUpdatedAt}`;
    const rows = await rest.patch<T>(table, query, patch);
    if (rows[0]) return rows[0];
    // Nothing matched: tell "changed elsewhere" from "gone".
    const existing = await rest.select<{ id: string }>(table, { select: 'id', id: `eq.${id}`, limit: '1' });
    throw new CatalogError(existing.length > 0 && expectedUpdatedAt !== undefined ? 'STALE' : 'NOT_FOUND');
  }

  return {
    listCategories: () => rest.select<CategoryRow>('categories', { select: '*', order: BY_SORT }),
    getCategory: (id) => getById<CategoryRow>('categories', id),
    createCategory: (input) => create<CategoryRow>('categories', input),
    updateCategory: (id, patch, options) => update<CategoryRow>('categories', id, patch, options?.expectedUpdatedAt),
    deleteCategory: (id) => rest.remove('categories', { id: `eq.${id}` }),

    listAlbums: (filter = {}) =>
      rest.select<AlbumRow>('albums', {
        select: '*',
        order: BY_SORT,
        ...(filter.categoryId === undefined ? {} : { category_id: `eq.${filter.categoryId}` }),
      }),
    getAlbum: (id) => getById<AlbumRow>('albums', id),
    createAlbum: (input) => create<AlbumRow>('albums', input),
    updateAlbum: (id, patch, options) => update<AlbumRow>('albums', id, patch, options?.expectedUpdatedAt),
    deleteAlbum: (id) => rest.remove('albums', { id: `eq.${id}` }),

    listPhotos: (albumId) =>
      rest.select<PhotoRow>('photos', { select: '*', album_id: `eq.${albumId}`, order: BY_SORT }),
    getPhoto: (id) => getById<PhotoRow>('photos', id),
    async updatePhoto(id, patch, options) {
      // The database grants update on four columns only; refuse anything else before the request.
      if (Object.keys(patch).some((k) => !PHOTO_PATCH_COLUMNS.includes(k))) throw new CatalogError('INVALID');
      return update<PhotoRow>('photos', id, patch, options?.expectedUpdatedAt);
    },

    async getSiteState() {
      const rows = await rest.select<SiteStateRow>('site_state', { select: '*', limit: '1' });
      if (!rows[0]) throw new CatalogError('NOT_FOUND');
      return rows[0];
    },
    listPublishLog: (limit) =>
      rest.select<PublishLogRow>('publish_log', {
        select: '*',
        order: 'requested_at.desc,id.desc',
        limit: String(Math.max(0, Math.trunc(limit))),
      }),
  };
}
