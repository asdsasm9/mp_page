/**
 * Reserve and commit rules shared by the Worker routes and both in-memory fakes (admin fake world,
 * migrate-legacy fake backend). Pure. The SQL (reserve_uploads, register_photo) and the Worker
 * routes are the source of truth; these helpers carry exactly their arithmetic.
 */
import { canReserve } from './quota';
import { sumBytes, type PhotoVariants } from './variants';

/** Declared byte size of each variant, in the order of `allKeys` (master, webp tiers, jpeg, og). */
export function variantBytes(v: PhotoVariants): number[] {
  return [v.master.bytes, ...v.webp.map((e) => e.bytes), v.jpeg.bytes, v.og.bytes];
}

/** Total bytes of one reserve item (all of its files). */
export function itemBytes(files: readonly { bytes: number }[]): number {
  return files.reduce((n, f) => n + f.bytes, 0);
}

/** A single file over the per-file limit makes the whole reserve item FILE_TOO_LARGE. */
export function hasOversizedFile(files: readonly { bytes: number }[], maxUploadBytes: number): boolean {
  return files.some((f) => f.bytes > maxUploadBytes);
}

/** Sum of bytes_total over photo rows (the "used" side of the quota). */
export function totalBytes(rows: Iterable<{ bytes_total: number }>): number {
  let n = 0;
  for (const r of rows) n += r.bytes_total;
  return n;
}

/** A reservation counts while expires_at > now. Expired rows linger until reserve_uploads purges them. */
export function reservationActive(reservation: { expiresAtMs: number }, nowMs: number): boolean {
  return reservation.expiresAtMs > nowMs;
}

/** The objects must not be larger than what was reserved. Applies to any existing row, expired or not. */
export function commitFitsReservation(actualBytes: number, reservedBytes: number): boolean {
  return actualBytes <= reservedBytes;
}

export interface CommitBytesInput {
  variants: PhotoVariants;
  bytesTotal: number;
  /** HEAD size of each object in `allKeys` order; null for a missing object. */
  actual: readonly (number | null)[];
  maxUploadBytes: number;
  /** Bytes of the reservation row for this photo, if there is one (active or not). */
  reservedBytes?: number | null;
}

/**
 * The Worker's pre-database verification: every object exists with its declared size and within the
 * per-file limit, the sizes add up to bytes_total and to the variants sum, and (when a reservation
 * row exists) the total does not exceed it. false means KEY_MISMATCH.
 */
export function checkCommitBytes(i: CommitBytesInput): boolean {
  const declared = variantBytes(i.variants);
  if (i.actual.length !== declared.length) return false;
  let sum = 0;
  for (const [idx, size] of i.actual.entries()) {
    if (size === null || size !== declared[idx] || size > i.maxUploadBytes) return false;
    sum += size;
  }
  if (sum !== i.bytesTotal || sumBytes(i.variants) !== i.bytesTotal) return false;
  if (i.reservedBytes != null && !commitFitsReservation(sum, i.reservedBytes)) return false;
  return true;
}

/** register_photo quota: used + other live reservations + this photo must fit; exactly at hard is allowed. */
export function commitQuotaOk(used: number, othersReserved: number, bytes: number, hard: number): boolean {
  return canReserve({ used, reserved: othersReserved, hard }, bytes);
}
