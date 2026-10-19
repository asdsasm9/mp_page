/** Error codes raised by SQL functions (message equals the code), see WP-2 section 3.2. */
export const API_ERROR_CODES = [
  'NOT_ADMIN',
  'STORAGE_FULL',
  'FILE_TOO_LARGE',
  'BATCH_TOO_LARGE',
  'PUBLISH_TOO_SOON',
  'BYTES_MISMATCH',
  'ALBUM_NOT_FOUND',
  'KEY_MISMATCH',
  'CONFLICT',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && (API_ERROR_CODES as readonly string[]).includes(value);
}
