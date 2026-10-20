/**
 * Catalog reads and writes over PostgREST under the user's JWT. Photos are never inserted or deleted
 * here (decision D-5): rows are created by /uploads/commit and removed by /photos/delete, and only
 * album_id, sort, alt and caption can be updated. Lists are ordered by sort, then id.
 *
 * Failures: CatalogError (STALE, NOT_FOUND, DUPLICATE_SLUG, IN_USE, COVER_NOT_IN_ALBUM, INVALID),
 * ApiError UNAUTHENTICATED (401, expired token), NetworkError.
 */
import type { AlbumRow, AppConfigRow, CategoryRow, PhotoRow, PublishLogRow, SiteStateRow } from '@mp/shared';

export type CategoryInput = Pick<CategoryRow, 'slug' | 'name'> &
  Partial<Pick<CategoryRow, 'description' | 'seo_title' | 'seo_description' | 'sort' | 'visible'>>;
export type CategoryPatch = Partial<Omit<CategoryRow, 'id' | 'created_at' | 'updated_at'>>;

export type AlbumInput = Pick<AlbumRow, 'category_id' | 'slug' | 'title'> &
  Partial<
    Pick<AlbumRow, 'place' | 'shot_on' | 'description' | 'seo_title' | 'seo_description' | 'sort' | 'published'>
  >;
export type AlbumPatch = Partial<Omit<AlbumRow, 'id' | 'created_at' | 'updated_at' | 'legacy_id'>>;

/** The only photo columns the database lets the browser update. */
export type PhotoPatch = Partial<Pick<PhotoRow, 'album_id' | 'sort' | 'alt' | 'caption'>>;

export interface UpdateOptions {
  /** Optimistic concurrency: the update only applies while the row still has this updated_at (else STALE). */
  expectedUpdatedAt?: string;
}

export interface CatalogPort {
  listCategories(): Promise<CategoryRow[]>;
  getCategory(id: string): Promise<CategoryRow | null>;
  createCategory(input: CategoryInput): Promise<CategoryRow>;
  updateCategory(id: string, patch: CategoryPatch, options?: UpdateOptions): Promise<CategoryRow>;
  /** Refused with IN_USE while the category still has albums. */
  deleteCategory(id: string): Promise<void>;

  listAlbums(filter?: { categoryId?: string }): Promise<AlbumRow[]>;
  getAlbum(id: string): Promise<AlbumRow | null>;
  createAlbum(input: AlbumInput): Promise<AlbumRow>;
  updateAlbum(id: string, patch: AlbumPatch, options?: UpdateOptions): Promise<AlbumRow>;
  /** Refused with IN_USE while the album still has photos (delete them through the Worker first). */
  deleteAlbum(id: string): Promise<void>;

  listPhotos(albumId: string): Promise<PhotoRow[]>;
  getPhoto(id: string): Promise<PhotoRow | null>;
  updatePhoto(id: string, patch: PhotoPatch, options?: UpdateOptions): Promise<PhotoRow>;

  /** The single app_config row (upload limits); readable by admins only. */
  getAppConfig(): Promise<AppConfigRow>;
  getSiteState(): Promise<SiteStateRow>;
  /** Newest first. */
  listPublishLog(limit: number): Promise<PublishLogRow[]>;
}
