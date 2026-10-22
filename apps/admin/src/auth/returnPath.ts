/**
 * Where to go after the Google round trip. The path survives the full-page redirect in sessionStorage and is
 * validated both when stored and when read: an app path only (starts with "/", not "//", not a URL with a
 * scheme, not backslash tricks, not the login page itself).
 */
const KEY = 'mp-admin-return-to';
const LOGIN_PATH = '/prihlaseni';
const FALLBACK = '/';

export function sanitizeReturnPath(value: unknown): string {
  if (typeof value !== 'string') return FALLBACK;
  if (!value.startsWith('/') || value.startsWith('//')) return FALLBACK;
  if (value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return FALLBACK;
  const path = value.split(/[?#]/, 1)[0]!;
  if (path === LOGIN_PATH || path.startsWith(`${LOGIN_PATH}/`)) return FALLBACK;
  return value;
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Stores the sanitized path and returns it. */
export function storeReturnPath(value: unknown): string {
  const path = sanitizeReturnPath(value);
  try {
    storage()?.setItem(KEY, path);
  } catch {
    // Storage blocked: the sign-in still works, it lands on the start page.
  }
  return path;
}

/** Reads and clears the stored path (re-validated); the start page when nothing usable is stored. */
export function takeReturnPath(): string {
  const s = storage();
  let raw: string | null = null;
  try {
    raw = s?.getItem(KEY) ?? null;
    s?.removeItem(KEY);
  } catch {
    raw = null;
  }
  return sanitizeReturnPath(raw);
}
