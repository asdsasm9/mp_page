/**
 * Pure state of the album lightbox (no DOM). The dialog script in lightbox.ts renders this state.
 *
 * Decision: next at the last photo and previous at the first photo STOP (the state is unchanged and the
 * matching button is disabled). Wrapping would hide the end of the album from keyboard and screen reader users.
 * Closing returns focus to the opener, the thumbnail that opened the lightbox (`focusIndex`).
 */
export interface LightboxState {
  readonly open: boolean;
  /** Photo shown, 0-based. */
  readonly index: number;
  readonly count: number;
  /** Thumbnail that opened the lightbox, or null while closed. */
  readonly opener: number | null;
}

export const initial = (count: number): LightboxState => ({ open: false, index: 0, count, opener: null });

export function open(state: LightboxState, index: number): LightboxState {
  if (!Number.isInteger(index) || index < 0 || index >= state.count) return state;
  return { ...state, open: true, index, opener: index };
}

export function next(state: LightboxState): LightboxState {
  if (!state.open || state.index >= state.count - 1) return state;
  return { ...state, index: state.index + 1 };
}

export function prev(state: LightboxState): LightboxState {
  if (!state.open || state.index <= 0) return state;
  return { ...state, index: state.index - 1 };
}

export function close(state: LightboxState): LightboxState {
  return { ...state, open: false, opener: null };
}

/** Thumbnail to focus after closing: the opener of the state before `close`. */
export const focusIndex = (before: LightboxState): number | null => before.opener;

export const hasNext = (s: LightboxState): boolean => s.index < s.count - 1;
export const hasPrev = (s: LightboxState): boolean => s.index > 0;

/** Maps a key to an action; null for any other key. */
export function keyAction(key: string): 'next' | 'prev' | null {
  if (key === 'ArrowRight') return 'next';
  if (key === 'ArrowLeft') return 'prev';
  return null;
}
