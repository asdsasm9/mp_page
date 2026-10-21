/**
 * Quota math. Pure; planBatch mirrors the SQL function reserve_uploads (WP-2 section 3.3).
 * All numbers are decimal bytes, the same unit as the limits.
 */
import { DEFAULT_LIMITS } from './limits';

export type QuotaLevel = 'ok' | 'warn' | 'full';

export interface QuotaState {
  used: number;
  reserved: number;
  hard: number;
  warn: number;
}

export interface QuotaEvaluation {
  level: QuotaLevel;
  remaining: number;
  /** (used + reserved) / hard as a percentage, not clamped. */
  percent: number;
}

/** Warn when used + reserved >= warn; full when >= hard. */
export function evaluateQuota(s: QuotaState): QuotaEvaluation {
  const total = s.used + s.reserved;
  const level: QuotaLevel = total >= s.hard ? 'full' : total >= s.warn ? 'warn' : 'ok';
  return {
    level,
    remaining: Math.max(s.hard - total, 0),
    percent: s.hard > 0 ? (total / s.hard) * 100 : 100,
  };
}

/** Exactly at the limit is allowed. */
export function canReserve(s: Pick<QuotaState, 'used' | 'reserved' | 'hard'>, bytes: number): boolean {
  return s.used + s.reserved + bytes <= s.hard;
}

export interface BatchItem {
  photo_id: string;
  bytes: number;
}

export type BatchItemCode = 'FILE_TOO_LARGE' | 'STORAGE_FULL';

export interface BatchItemResult {
  photo_id: string;
  ok: boolean;
  code?: BatchItemCode;
}

export interface BatchPlanState extends QuotaState {
  maxUploadBytes?: number;
  maxFilesPerBatch?: number;
}

export interface BatchPlan {
  results: BatchItemResult[];
  used_bytes: number;
  reserved_bytes: number;
  hard: number;
  warn: number;
  level: QuotaLevel;
}

/** Raised for a whole batch (the SQL function raises the same message). */
export class BatchTooLargeError extends Error {
  readonly code = 'BATCH_TOO_LARGE' as const;
  constructor() {
    super('BATCH_TOO_LARGE');
    this.name = 'BatchTooLargeError';
  }
}

/**
 * Per item, in order: bytes > max upload -> FILE_TOO_LARGE; used + reserved + bytes > hard ->
 * STORAGE_FULL; otherwise accepted and added to reserved. Refused items consume nothing, so a
 * later smaller item can still be accepted (first-fit). More than maxFilesPerBatch items throws.
 */
export function planBatch(state: BatchPlanState, items: BatchItem[]): BatchPlan {
  const maxUpload = state.maxUploadBytes ?? DEFAULT_LIMITS.maxUploadBytes;
  const maxFiles = state.maxFilesPerBatch ?? DEFAULT_LIMITS.maxFilesPerBatch;
  if (items.length > maxFiles) throw new BatchTooLargeError();

  let reserved = state.reserved;
  const results: BatchItemResult[] = items.map((it) => {
    if (it.bytes > maxUpload) return { photo_id: it.photo_id, ok: false, code: 'FILE_TOO_LARGE' };
    if (!canReserve({ used: state.used, reserved, hard: state.hard }, it.bytes)) {
      return { photo_id: it.photo_id, ok: false, code: 'STORAGE_FULL' };
    }
    reserved += it.bytes;
    return { photo_id: it.photo_id, ok: true };
  });

  return {
    results,
    used_bytes: state.used,
    reserved_bytes: reserved,
    hard: state.hard,
    warn: state.warn,
    level: evaluateQuota({ used: state.used, reserved, hard: state.hard, warn: state.warn }).level,
  };
}
