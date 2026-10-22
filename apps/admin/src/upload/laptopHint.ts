/**
 * The one-time "use a laptop for large batches" hint of the phone upload sheet (plan WP5-23). Remembered in
 * localStorage; storage that throws (private mode, blocked) just means the hint may show again, never an error.
 */
export const LAPTOP_HINT_KEY = 'mp-admin:laptop-hint-seen';

/** The phone layout of the queue sheet (same breakpoint as the bottom navigation). */
export const PHONE_QUERY = '(max-width: 39.99rem)';

export function isPhoneViewport(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches;
}

export function hasSeenLaptopHint(): boolean {
  try {
    return window.localStorage.getItem(LAPTOP_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function markLaptopHintSeen(): void {
  try {
    window.localStorage.setItem(LAPTOP_HINT_KEY, '1');
  } catch {
    /* not remembered: the hint may appear again */
  }
}
