import { describe, expect, it } from 'vitest';
import { apply, goTo, initial, keyAction, next, positionLabel, prev, showControls, swipeAction } from './carousel-state';

describe('carousel state', () => {
  it('starts on the first slide', () => {
    expect(initial(3)).toEqual({ index: 0, count: 3 });
    expect(positionLabel(initial(3))).toBe('1 / 3');
  });

  it('next and prev wrap around', () => {
    let s = initial(3);
    s = next(s);
    s = next(s);
    expect(s.index).toBe(2);
    expect(positionLabel(s)).toBe('3 / 3');
    s = next(s);
    expect(s.index).toBe(0);
    expect(prev(s).index).toBe(2);
    expect(prev(prev(s)).index).toBe(1);
  });

  it('0 and 1 reviews: nothing moves, no controls', () => {
    for (const n of [0, 1]) {
      const s = initial(n);
      expect(next(s)).toBe(s);
      expect(prev(s)).toBe(s);
      expect(showControls(s)).toBe(false);
    }
    expect(showControls(initial(2))).toBe(true);
  });

  it('bad counts become 0', () => {
    expect(initial(Number.NaN).count).toBe(0);
    expect(initial(-4).count).toBe(0);
  });

  it('goTo only accepts valid indexes', () => {
    const s = initial(3);
    expect(goTo(s, 2).index).toBe(2);
    expect(goTo(s, 3)).toBe(s);
    expect(goTo(s, -1)).toBe(s);
    expect(goTo(s, 1.5)).toBe(s);
  });

  it('keys: only plain Left and Right', () => {
    expect(keyAction('ArrowRight')).toBe('next');
    expect(keyAction('ArrowLeft')).toBe('prev');
    expect(keyAction('ArrowLeft', { alt: true })).toBeNull();
    expect(keyAction('ArrowRight', { meta: true })).toBeNull();
    expect(keyAction('ArrowDown')).toBeNull();
    expect(keyAction('Enter')).toBeNull();
  });

  it('swipe: 40 px threshold, horizontal wins, left means next', () => {
    expect(swipeAction(-60, 5)).toBe('next');
    expect(swipeAction(60, -5)).toBe('prev');
    expect(swipeAction(-39, 0)).toBeNull();
    expect(swipeAction(-40, 0)).toBe('next');
    expect(swipeAction(-50, 80)).toBeNull();
  });

  it('apply maps actions to transitions', () => {
    const s = initial(3);
    expect(apply(s, 'next').index).toBe(1);
    expect(apply(s, 'prev').index).toBe(2);
    expect(apply(s, null)).toBe(s);
  });
});
