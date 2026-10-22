import { describe, expect, it } from 'vitest';
import { close, focusIndex, hasNext, hasPrev, initial, keyAction, next, open, prev } from './lightbox-state';

describe('lightbox state', () => {
  const s0 = initial(3);

  it('starts closed and ignores next/prev while closed', () => {
    expect(s0.open).toBe(false);
    expect(next(s0)).toBe(s0);
    expect(prev(s0)).toBe(s0);
  });

  it('opens at a valid index and remembers the opener; invalid indexes are ignored', () => {
    const s = open(s0, 1);
    expect(s).toMatchObject({ open: true, index: 1, opener: 1 });
    expect(open(s0, -1)).toBe(s0);
    expect(open(s0, 3)).toBe(s0);
    expect(open(s0, 1.5)).toBe(s0);
  });

  it('moves next and previous', () => {
    let s = open(s0, 0);
    s = next(s);
    s = next(s);
    expect(s.index).toBe(2);
    s = prev(s);
    expect(s.index).toBe(1);
    expect(s.opener).toBe(0);
  });

  it('stops at both ends (no wrap)', () => {
    const last = next(next(open(s0, 0)));
    expect(next(last)).toBe(last);
    expect(hasNext(last)).toBe(false);
    const first = open(s0, 0);
    expect(prev(first)).toBe(first);
    expect(hasPrev(first)).toBe(false);
    expect(hasNext(first)).toBe(true);
    expect(hasPrev(last)).toBe(true);
  });

  it('close returns focus to the opener, even after navigating', () => {
    const moved = next(next(open(s0, 0)));
    expect(focusIndex(moved)).toBe(0);
    const closed = close(moved);
    expect(closed.open).toBe(false);
    expect(closed.opener).toBeNull();
    expect(focusIndex(closed)).toBeNull();
  });

  it('maps arrow keys only', () => {
    expect(keyAction('ArrowRight')).toBe('next');
    expect(keyAction('ArrowLeft')).toBe('prev');
    expect(keyAction('Escape')).toBeNull();
    expect(keyAction('a')).toBeNull();
  });
});
