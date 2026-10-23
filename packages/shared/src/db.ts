/** Row types mirroring the public schema (WP-2 section 3.1). Timestamps are ISO strings, dates YYYY-MM-DD. */
import type { PhotoVariants } from './variants';

export interface AdminRow {
  user_id: string;
  created_at: string;
}

export interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  seo_title: string | null;
  seo_description: string | null;
  sort: number;
  visible: boolean;
  /** Main photo of the category (a photo of one of its albums), null = automatic. */
  cover_photo_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlbumRow {
  id: string;
  category_id: string;
  slug: string;
  title: string;
  place: string | null;
  shot_on: string | null;
  description: string | null;
  seo_title: string | null;
  seo_description: string | null;
  cover_photo_id: string | null;
  sort: number;
  published: boolean;
  legacy_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PhotoRow {
  id: string;
  album_id: string;
  master_key: string;
  width: number;
  height: number;
  variants: PhotoVariants;
  bytes_total: number;
  dominant_color: string | null;
  alt: string | null;
  caption: string | null;
  sort: number;
  legacy_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface UrlHistoryRow {
  id: string;
  old_path: string;
  target: string | null;
  status: 301 | 410;
  created_at: string;
}

export interface AppConfigRow {
  id: true;
  quota_hard_bytes: number;
  quota_warn_bytes: number;
  max_upload_bytes: number;
  max_files_per_batch: number;
  reservation_ttl_min: number;
}

export interface SiteStateRow {
  id: true;
  pending_changes: number;
  last_published_at: string | null;
  last_publish_requested_at: string | null;
}

export interface PublishLogRow {
  id: string;
  requested_by: string | null;
  requested_at: string;
  finished_at: string | null;
  status: 'started' | 'ok' | 'failed';
  pending_seen: number | null;
  album_count: number | null;
  photo_count: number | null;
  snapshot_bytes: number | null;
  error: string | null;
}

export interface UploadReservationRow {
  photo_id: string;
  requested_by: string | null;
  bytes: number;
  created_at: string;
  expires_at: string;
}

export type ChangeKind = 'added' | 'edited' | 'deleted' | 'reordered';
/** The single settings row (T-285). */
export interface SiteSettingsRow {
  id: true;
  /** Photo shown in the home hero, null = automatic (bundled image). */
  hero_photo_id: string | null;
}

export type ChangeTable = 'categories' | 'albums' | 'photos' | 'site_settings';

/** One catalog row that differs from the last published site (written by the log_change trigger). */
export interface ChangeLogRow {
  id: number;
  at: string;
  table_name: ChangeTable;
  row_id: string;
  kind: ChangeKind;
  /** Name at change time; may be '' for a photo without alt text or caption. */
  label: string;
  category_id: string | null;
  category_name: string | null;
  album_id: string | null;
  album_title: string | null;
}

export interface KeepaliveRow {
  id: true;
  last_ping: string | null;
  pings: number;
}

/** Column names per table; a drift test compares these with information_schema (WP2-19). */
export const DB_COLUMNS = {
  admin_emails: ['email', 'created_at'],
  categories: [
    'id', 'slug', 'name', 'description', 'seo_title', 'seo_description',
    'sort', 'visible', 'created_at', 'updated_at', 'cover_photo_id',
  ],
  albums: [
    'id', 'category_id', 'slug', 'title', 'place', 'shot_on', 'description',
    'seo_title', 'seo_description', 'cover_photo_id', 'sort', 'published',
    'legacy_id', 'created_at', 'updated_at',
  ],
  photos: [
    'id', 'album_id', 'master_key', 'width', 'height', 'variants', 'bytes_total',
    'dominant_color', 'alt', 'caption', 'sort', 'legacy_key', 'created_at', 'updated_at',
  ],
  url_history: ['id', 'old_path', 'target', 'status', 'created_at'],
  app_config: [
    'id', 'quota_hard_bytes', 'quota_warn_bytes', 'max_upload_bytes',
    'max_files_per_batch', 'reservation_ttl_min',
  ],
  site_state: ['id', 'pending_changes', 'last_published_at', 'last_publish_requested_at'],
  publish_log: [
    'id', 'requested_by', 'requested_at', 'finished_at', 'status', 'pending_seen',
    'album_count', 'photo_count', 'snapshot_bytes', 'error',
  ],
  upload_reservations: ['photo_id', 'requested_by', 'bytes', 'created_at', 'expires_at'],
  keepalive: ['id', 'last_ping', 'pings'],
  site_settings: ['id', 'hero_photo_id'],
  change_log: [
    'id', 'at', 'table_name', 'row_id', 'kind', 'label',
    'category_id', 'category_name', 'album_id', 'album_title',
  ],
} as const;

export type TableName = keyof typeof DB_COLUMNS;
