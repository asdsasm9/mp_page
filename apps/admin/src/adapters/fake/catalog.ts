/** Fake PostgREST: the table constraints, grants, triggers and RLS-free paths of supabase/migrations, in memory. */
import { isReservedCategorySlug, isValidSlug, type AlbumRow, type CategoryRow, type PhotoRow } from '@mp/shared';
import { CatalogError, type CatalogPort } from '../../ports';
import { bySortThenId, copy, type Core } from './core';

const PHOTO_PATCH_COLUMNS = ['album_id', 'sort', 'alt', 'caption'];

const tooLong = (value: string | null | undefined, max: number): boolean =>
  typeof value === 'string' && value.length > max;
const badLength = (value: string, min: number, max: number): boolean => value.length < min || value.length > max;

export function createFakeCatalog(core: Core): CatalogPort {
  const { state } = core;
  const guard = (op: Parameters<Core['guard']>[0]) => core.guard(op, { auth: true });

  function checkCategory(row: Pick<CategoryRow, 'slug' | 'name' | 'seo_title' | 'seo_description'>, selfId?: string) {
    if (!isValidSlug(row.slug) || isReservedCategorySlug(row.slug)) throw new CatalogError('INVALID');
    if (badLength(row.name, 1, 80) || tooLong(row.seo_title, 120) || tooLong(row.seo_description, 300)) {
      throw new CatalogError('INVALID');
    }
    for (const c of state.categories.values()) {
      if (c.id !== selfId && c.slug === row.slug) throw new CatalogError('DUPLICATE_SLUG');
    }
  }

  function checkAlbum(row: AlbumRow) {
    if (!isValidSlug(row.slug, { legacy: true })) throw new CatalogError('INVALID');
    if (badLength(row.title, 1, 120) || tooLong(row.seo_title, 120) || tooLong(row.seo_description, 300)) {
      throw new CatalogError('INVALID');
    }
    if (row.shot_on !== null && !/^\d{4}-\d{2}-\d{2}$/.test(row.shot_on)) throw new CatalogError('INVALID');
    if (!state.categories.has(row.category_id)) throw new CatalogError('NOT_FOUND');
    for (const a of state.albums.values()) {
      if (a.id !== row.id && a.slug === row.slug) throw new CatalogError('DUPLICATE_SLUG');
    }
    if (row.cover_photo_id !== null && state.photos.get(row.cover_photo_id)?.album_id !== row.id) {
      throw new CatalogError('COVER_NOT_IN_ALBUM');
    }
  }

  const stale = (row: { updated_at: string }, expected?: string) => {
    if (expected !== undefined && row.updated_at !== expected) throw new CatalogError('STALE');
  };

  return {
    async listCategories() {
      guard('catalog.listCategories');
      return copy([...state.categories.values()].sort(bySortThenId));
    },
    async getCategory(id) {
      guard('catalog.getCategory');
      return copy(state.categories.get(id) ?? null);
    },
    async createCategory(input) {
      guard('catalog.createCategory');
      const now = core.iso();
      const row: CategoryRow = {
        id: core.ids.uuid(),
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        seo_title: input.seo_title ?? null,
        seo_description: input.seo_description ?? null,
        sort: input.sort ?? 0,
        visible: input.visible ?? true,
        created_at: now,
        updated_at: now,
      };
      checkCategory(row);
      state.categories.set(row.id, row);
      core.bump();
      return copy(row);
    },
    async updateCategory(id, patch, options = {}) {
      guard('catalog.updateCategory');
      const row = state.categories.get(id);
      if (!row) throw new CatalogError('NOT_FOUND');
      stale(row, options.expectedUpdatedAt);
      const next: CategoryRow = { ...row, ...patch, id: row.id, created_at: row.created_at, updated_at: row.updated_at };
      checkCategory(next, id);
      next.updated_at = core.stamp(row.updated_at);
      state.categories.set(id, next);
      core.bump();
      return copy(next);
    },
    async deleteCategory(id) {
      guard('catalog.deleteCategory');
      if (!state.categories.has(id)) return;
      for (const a of state.albums.values()) if (a.category_id === id) throw new CatalogError('IN_USE');
      state.categories.delete(id);
      core.bump();
    },

    async listAlbums(filter = {}) {
      guard('catalog.listAlbums');
      const rows = [...state.albums.values()].filter(
        (a) => filter.categoryId === undefined || a.category_id === filter.categoryId,
      );
      return copy(rows.sort(bySortThenId));
    },
    async getAlbum(id) {
      guard('catalog.getAlbum');
      return copy(state.albums.get(id) ?? null);
    },
    async createAlbum(input) {
      guard('catalog.createAlbum');
      const now = core.iso();
      const row: AlbumRow = {
        id: core.ids.uuid(),
        category_id: input.category_id,
        slug: input.slug,
        title: input.title,
        place: input.place ?? null,
        shot_on: input.shot_on ?? null,
        description: input.description ?? null,
        seo_title: input.seo_title ?? null,
        seo_description: input.seo_description ?? null,
        cover_photo_id: null,
        sort: input.sort ?? 0,
        published: input.published ?? false,
        legacy_id: null,
        created_at: now,
        updated_at: now,
      };
      checkAlbum(row);
      state.albums.set(row.id, row);
      core.bump();
      return copy(row);
    },
    async updateAlbum(id, patch, options = {}) {
      guard('catalog.updateAlbum');
      const row = state.albums.get(id);
      if (!row) throw new CatalogError('NOT_FOUND');
      stale(row, options.expectedUpdatedAt);
      const next: AlbumRow = {
        ...row,
        ...patch,
        id: row.id,
        legacy_id: row.legacy_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
      checkAlbum(next);
      next.updated_at = core.stamp(row.updated_at);
      state.albums.set(id, next);
      core.bump();
      return copy(next);
    },
    async deleteAlbum(id) {
      guard('catalog.deleteAlbum');
      if (!state.albums.has(id)) return;
      for (const p of state.photos.values()) if (p.album_id === id) throw new CatalogError('IN_USE');
      state.albums.delete(id);
      core.bump();
    },

    async listPhotos(albumId) {
      guard('catalog.listPhotos');
      const rows = [...state.photos.values()].filter((p) => p.album_id === albumId);
      return copy(rows.sort(bySortThenId));
    },
    async getPhoto(id) {
      guard('catalog.getPhoto');
      return copy(state.photos.get(id) ?? null);
    },
    async updatePhoto(id, patch, options = {}) {
      guard('catalog.updatePhoto');
      // Column grant: update (album_id, sort, alt, caption) only.
      if (Object.keys(patch).some((k) => !PHOTO_PATCH_COLUMNS.includes(k))) throw new CatalogError('INVALID');
      const row = state.photos.get(id);
      if (!row) throw new CatalogError('NOT_FOUND');
      stale(row, options.expectedUpdatedAt);
      const next: PhotoRow = { ...row, ...patch };
      if (tooLong(next.alt, 300) || tooLong(next.caption, 500)) throw new CatalogError('INVALID');
      if (!state.albums.has(next.album_id)) throw new CatalogError('NOT_FOUND');
      if (next.album_id !== row.album_id) clearCoversOfPhoto(core, id);
      next.updated_at = core.stamp(row.updated_at);
      state.photos.set(id, next);
      core.bump();
      return copy(next);
    },

    async getAppConfig() {
      guard('catalog.getAppConfig');
      const l = state.limits;
      return {
        id: true,
        quota_hard_bytes: l.quotaHardBytes,
        quota_warn_bytes: l.quotaWarnBytes,
        max_upload_bytes: l.maxUploadBytes,
        max_files_per_batch: l.maxFilesPerBatch,
        reservation_ttl_min: l.reservationTtlMin,
      };
    },
    async getSiteState() {
      guard('catalog.getSiteState');
      return copy(state.site);
    },
    async listPublishLog(limit) {
      guard('catalog.listPublishLog');
      const rows = [...state.publishLog].sort(
        (a, b) => (a.requested_at < b.requested_at ? 1 : a.requested_at > b.requested_at ? -1 : a.id < b.id ? 1 : -1),
      );
      return copy(rows.slice(0, Math.max(0, limit)));
    },
  };
}

/** Trigger clear_cover_on_photo_change: a photo that leaves its album or is deleted stops being its cover. */
export function clearCoversOfPhoto(core: Core, photoId: string): void {
  for (const album of core.state.albums.values()) {
    if (album.cover_photo_id !== photoId) continue;
    album.cover_photo_id = null;
    album.updated_at = core.stamp(album.updated_at);
    core.bump();
  }
}
