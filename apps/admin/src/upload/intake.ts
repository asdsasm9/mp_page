/**
 * Intake of picked files: natural sort by name, type and size validation against the configured limits, and the
 * session-only duplicate check (same album, name and size). Pure; the limits come from the caller (app_config).
 */
import { cs } from '../i18n/cs';
import type { FileLike } from './types';

export interface IntakeLimits {
  /** app_config.max_upload_bytes */
  maxUploadBytes: number;
}

const MIME_OK = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const EXT_OK = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);

/** Browsers often report no type (or octet-stream) for HEIC: then the extension decides. */
export function isSupportedType(file: Pick<FileLike, 'name' | 'type'>): boolean {
  const mime = file.type.trim().toLowerCase();
  if (MIME_OK.has(mime)) return true;
  if (mime !== '' && mime !== 'application/octet-stream') return false;
  const dot = file.name.lastIndexOf('.');
  return dot >= 0 && EXT_OK.has(file.name.slice(dot + 1).toLowerCase());
}

const DIGITS = /(\d+)/;

/** "IMG_2" before "IMG_10"; case-insensitive; equal names compare 0. No Intl (no ICU dependence). */
export function naturalCompare(a: string, b: string): number {
  const pa = a.toLowerCase().split(DIGITS);
  const pb = b.toLowerCase().split(DIGITS);
  const n = Math.min(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const x = pa[i]!;
    const y = pb[i]!;
    if (i % 2 === 1) {
      const dx = BigInt(x);
      const dy = BigInt(y);
      if (dx !== dy) return dx < dy ? -1 : 1;
      if (x.length !== y.length) return x.length - y.length; // 01 before 1? keep a stable order for 1 and 01
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return pa.length - pb.length;
}

/** Stable natural sort by file name. */
export function sortNatural<T extends { name: string }>(files: readonly T[]): T[] {
  return files
    .map((file, index) => ({ file, index }))
    .sort((p, q) => naturalCompare(p.file.name, q.file.name) || p.index - q.index)
    .map((p) => p.file);
}

/** Session duplicate key: same album, same name, same size. */
export function fingerprint(albumId: string, file: Pick<FileLike, 'name' | 'size'>): string {
  return `${albumId}|${file.name}|${file.size}`;
}

export type RejectReason = 'type' | 'size';

export interface Rejected<F extends FileLike> {
  file: F;
  reason: RejectReason;
  /** Czech text for the row. */
  message: string;
}

export interface IntakeResult<F extends FileLike> {
  /** Valid, not seen in this session, in natural-sort order: these are queued. */
  accepted: F[];
  /** Valid but already uploaded in this session: the UI asks "Přeskočit / Nahrát znovu" (default skip). */
  duplicates: F[];
  rejected: Array<Rejected<F>>;
}

export interface IntakeOptions {
  albumId: string;
  limits: IntakeLimits;
  /** Fingerprints of files already queued or uploaded in this session. */
  known?: ReadonlySet<string>;
}

export function intakeFiles<F extends FileLike>(files: readonly F[], options: IntakeOptions): IntakeResult<F> {
  const result: IntakeResult<F> = { accepted: [], duplicates: [], rejected: [] };
  const seen = new Set(options.known ?? []);
  for (const file of sortNatural(files)) {
    if (!isSupportedType(file)) {
      result.rejected.push({ file, reason: 'type', message: cs.upload.unsupported });
    } else if (file.size > options.limits.maxUploadBytes) {
      result.rejected.push({ file, reason: 'size', message: cs.upload.tooLarge });
    } else if (seen.has(fingerprint(options.albumId, file))) {
      result.duplicates.push(file);
    } else {
      // Two identical files in one pick count as one duplicate of the other.
      seen.add(fingerprint(options.albumId, file));
      result.accepted.push(file);
    }
  }
  return result;
}
