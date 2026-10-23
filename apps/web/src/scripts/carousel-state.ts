/**
 * Pure state of the Reference carousel (no DOM). reference-carousel.ts renders this state.
 *
 * Decision: unlike the lightbox, next after the last review wraps to the first and prev before the first wraps
 * to the last: reviews are a loop with no "end of the album" to reveal, and there is no autoplay.
 * 0 reviews: nothing to show (the section is not rendered); 1 review: no controls; N: controls and a position label.
 */
export interface CarouselState {
  /** Slide shown, 0-based. */
  readonly index: number;
  readonly count: number;
}

/** Horizontal distance in px a pointer must travel for a swipe to count. */
export const SWIPE_THRESHOLD = 40;

export const initial = (count: number): CarouselState => ({ index: 0, count: Math.max(0, Math.trunc(count) || 0) });

export function next(state: CarouselState): CarouselState {
  if (state.count < 2) return state;
  return { ...state, index: (state.index + 1) % state.count };
}

export function prev(state: CarouselState): CarouselState {
  if (state.count < 2) return state;
  return { ...state, index: (state.index - 1 + state.count) % state.count };
}

export function goTo(state: CarouselState, index: number): CarouselState {
  if (!Number.isInteger(index) || index < 0 || index >= state.count) return state;
  return { ...state, index };
}

/** `1 / 3`: the counter text. */
export const positionLabel = (state: CarouselState): string => `${state.index + 1} / ${state.count}`;

/** Arrows and counter only make sense with at least two reviews. */
export const showControls = (state: CarouselState): boolean => state.count > 1;

/** Key to action: Right/Left only, ignoring modified keys (browser history shortcuts). */
export function keyAction(key: string, mods: { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean } = {}): 'next' | 'prev' | null {
  if (mods.alt || mods.ctrl || mods.meta || mods.shift) return null;
  if (key === 'ArrowRight') return 'next';
  if (key === 'ArrowLeft') return 'prev';
  return null;
}

/** Swipe left (finger moves left, dx < 0) shows the next review. Mostly vertical or short moves are not swipes. */
export function swipeAction(dx: number, dy: number): 'next' | 'prev' | null {
  if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return null;
  return dx < 0 ? 'next' : 'prev';
}

export function apply(state: CarouselState, action: 'next' | 'prev' | null): CarouselState {
  if (action === 'next') return next(state);
  if (action === 'prev') return prev(state);
  return state;
}
