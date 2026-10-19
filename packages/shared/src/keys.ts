/** Storage key scheme. Keys derive from the photo id only, never from album or category. */
import type { PhotoVariants } from './variants';

export const WEBP_TIERS = [480, 960, 1600, 2400] as const;
export type WebpTier = (typeof WEBP_TIERS)[number];

export const SNAPSHOT_KEY = 'catalog/published.json';
export const MAX_KEY_LENGTH = 512;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Lowercase canonical uuid format only. */
export function isValidPhotoId(id: string): boolean {
  return typeof id === 'string' && UUID_RE.test(id);
}

function assertId(id: string): void {
  if (!isValidPhotoId(id)) throw new Error(`Invalid photo id: ${JSON.stringify(id)}`);
}

export function photoPrefix(id: string): string {
  assertId(id);
  return `photos/${id}/`;
}
export function masterKey(id: string): string {
  return `${photoPrefix(id)}master.jpg`;
}
export function webpKey(id: string, tier: WebpTier): string {
  if (!(WEBP_TIERS as readonly number[]).includes(tier)) throw new Error(`Invalid tier: ${tier}`);
  return `${photoPrefix(id)}${tier}.webp`;
}
export function jpegKey(id: string): string {
  return `${photoPrefix(id)}1600.jpg`;
}
export function ogKey(id: string): string {
  return `${photoPrefix(id)}og.jpg`;
}

/** Private-bucket backup file name: full-YYYYMMDDTHHMMSSZ.json (UTC). */
export function backupKey(date: Date): string {
  const iso = date.toISOString(); // 2026-10-19T12:00:00.000Z
  const stamp = iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `full-${stamp}.json`;
}

export type ParsedKey =
  | { kind: 'master'; id: string }
  | { kind: 'webp'; id: string; tier: WebpTier }
  | { kind: 'jpeg'; id: string }
  | { kind: 'og'; id: string };

export function parseKey(key: string): ParsedKey | null {
  const m = /^photos\/([^/]+)\/([^/]+)$/.exec(key);
  if (!m) return null;
  const id = m[1]!;
  const file = m[2]!;
  if (!isValidPhotoId(id)) return null;
  if (file === 'master.jpg') return { kind: 'master', id };
  if (file === '1600.jpg') return { kind: 'jpeg', id };
  if (file === 'og.jpg') return { kind: 'og', id };
  const w = /^(\d+)\.webp$/.exec(file);
  if (w) {
    const tier = Number(w[1]);
    if ((WEBP_TIERS as readonly number[]).includes(tier)) return { kind: 'webp', id, tier: tier as WebpTier };
  }
  return null;
}

/** Rejects "..", leading "/", backslash, empty and keys longer than 512. */
export function isSafeKey(key: string): boolean {
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) return false;
  if (key.startsWith('/') || key.includes('\\') || key.includes('..')) return false;
  return true;
}

/** Every key a photo owns, derived from its variants. */
export function allKeys(id: string, variants: Pick<PhotoVariants, 'webp'>): string[] {
  return [
    masterKey(id),
    ...variants.webp.map((v) => webpKey(id, v.tier as WebpTier)),
    jpegKey(id),
    ogKey(id),
  ];
}
