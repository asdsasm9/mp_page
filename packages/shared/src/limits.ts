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

/** Presigned PUT URLs live 15 minutes (Worker reserve route and both fakes). */
export const PRESIGN_EXPIRY_SEC = 15 * 60;

/** Orphan objects younger than this may belong to an upload that has not been committed yet (reconcile). */
export const ORPHAN_MIN_AGE_MS = 2 * 60 * 60 * 1000;

/** Minimum gap between two publishes (Worker publish route and the admin fake). */
export const PUBLISH_MIN_GAP_MS = 60_000;

/** Absolute provider ceiling the hard limit must never exceed (R2 free 10 GB). */
export const PROVIDER_MAX_BYTES = 10_000_000_000;
