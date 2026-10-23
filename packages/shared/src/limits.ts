/** Same numbers as the app_config defaults in the database (WP-2 section 3.1). Decimal bytes. */
export const DEFAULT_LIMITS = {
  quotaHardBytes: 9_500_000_000,
  quotaWarnBytes: 8_000_000_000,
  maxUploadBytes: 41_943_040,
  maxFilesPerBatch: 200,
  reservationTtlMin: 60,
} as const;

export type Limits = {
  quotaHardBytes: number;
  quotaWarnBytes: number;
  maxUploadBytes: number;
  maxFilesPerBatch: number;
  reservationTtlMin: number;
};

/**
 * Text field lengths in characters. The CATEGORY_*, ALBUM_TITLE_MAX, ALBUM_SEO_*_DB_MAX, CAPTION_MAX and
 * ALT_MAX (alt.ts) values are the SQL check constraints of supabase/migrations (apps/api/test/field-limits-parity.test.ts keeps them equal).
 * ALBUM_SEO_TITLE_MAX / ALBUM_SEO_DESCRIPTION_MAX are the stricter editor ceilings from docs/SEO.md (search
 * result snippets); the database allows the wider ALBUM_SEO_*_DB_MAX.
 */
export const CATEGORY_NAME_MAX = 80;
export const CATEGORY_SEO_TITLE_MAX = 120;
export const CATEGORY_SEO_DESCRIPTION_MAX = 300;
export const ALBUM_TITLE_MAX = 120;
export const ALBUM_PLACE_MAX = 120;
export const ALBUM_SEO_TITLE_MAX = 65;
export const ALBUM_SEO_DESCRIPTION_MAX = 160;
export const ALBUM_SEO_TITLE_DB_MAX = 120;
export const ALBUM_SEO_DESCRIPTION_DB_MAX = 300;
export const CAPTION_MAX = 500;

/** Presigned PUT URLs live 15 minutes (Worker reserve route and both fakes). */
export const PRESIGN_EXPIRY_SEC = 15 * 60;

/** Orphan objects younger than this may belong to an upload that has not been committed yet (reconcile). */
export const ORPHAN_MIN_AGE_MS = 2 * 60 * 60 * 1000;

/** Minimum gap between two publishes (Worker publish route and the admin fake). */
export const PUBLISH_MIN_GAP_MS = 60_000;

/** Absolute provider ceiling the hard limit must never exceed (R2 free 10 GB). */
export const PROVIDER_MAX_BYTES = 10_000_000_000;
