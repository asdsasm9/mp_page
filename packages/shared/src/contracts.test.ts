import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  DB_COLUMNS,
  DEFAULT_LIMITS,
  PROVIDER_MAX_BYTES,
  SHARED_VERSION,
  isApiErrorCode,
  type ApiErrorCode,
  type PhotoRow,
} from './index';

describe('DEFAULT_LIMITS', () => {
  it('equals the app_config defaults', () => {
    expect(DEFAULT_LIMITS).toEqual({
      quotaHardBytes: 9.5e9,
      quotaWarnBytes: 8e9,
      maxUploadBytes: 41943040,
      maxFilesPerBatch: 200,
      reservationTtlMin: 60,
    });
    expect(DEFAULT_LIMITS.quotaWarnBytes).toBeLessThanOrEqual(DEFAULT_LIMITS.quotaHardBytes);
    expect(DEFAULT_LIMITS.quotaHardBytes).toBeLessThanOrEqual(PROVIDER_MAX_BYTES);
  });
});

describe('ApiErrorCode', () => {
  it('matches section 3.2 exactly', () => {
    expect([...API_ERROR_CODES].sort()).toEqual(
      [
        'NOT_ADMIN', 'STORAGE_FULL', 'FILE_TOO_LARGE', 'BATCH_TOO_LARGE', 'PUBLISH_TOO_SOON',
        'BYTES_MISMATCH', 'ALBUM_NOT_FOUND', 'KEY_MISMATCH', 'CONFLICT',
      ].sort(),
    );
    const c: ApiErrorCode = 'CONFLICT';
    expect(isApiErrorCode(c)).toBe(true);
    expect(isApiErrorCode('NOPE')).toBe(false);
    expect(isApiErrorCode(42)).toBe(false);
  });
});

describe('DB_COLUMNS', () => {
  it('covers the 12 tables', () => {
    expect(Object.keys(DB_COLUMNS).sort()).toEqual(
      ['admin_emails', 'albums', 'app_config', 'categories', 'change_log', 'keepalive', 'photos', 'publish_log', 'site_settings', 'site_state', 'upload_reservations', 'url_history'].sort(),
    );
  });
  it('photos columns are the PhotoRow keys', () => {
    const keys: Array<keyof PhotoRow> = [...DB_COLUMNS.photos];
    expect(keys).toHaveLength(14);
  });
  it('has no duplicate columns', () => {
    for (const cols of Object.values(DB_COLUMNS)) expect(new Set(cols).size).toBe(cols.length);
  });
  it('index re-exports work', () => {
    expect(SHARED_VERSION).toBe(1);
  });
});
