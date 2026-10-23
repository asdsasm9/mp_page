import { describe, expect, it } from 'vitest';
import { applyEntries, pickCurrent } from './scrollspy-state';

const order = ['uvod', 'o-mne', 'portfolio', 'reference', 'kontakt'];

describe('scrollspy pickCurrent', () => {
  it('returns null when nothing is in the band', () => {
    expect(pickCurrent(order, new Set())).toBeNull();
  });

  it('returns the only visible section', () => {
    expect(pickCurrent(order, new Set(['portfolio']))).toBe('portfolio');
  });

  it('prefers the later section in document order when two are in the band', () => {
    expect(pickCurrent(order, new Set(['o-mne', 'portfolio']))).toBe('portfolio');
    expect(pickCurrent(order, new Set(['kontakt', 'o-mne']))).toBe('kontakt');
  });

  it('ignores ids that are not in the order list', () => {
    expect(pickCurrent(order, new Set(['footer']))).toBeNull();
  });
});

describe('scrollspy applyEntries', () => {
  it('adds entering and removes leaving sections without mutating the input', () => {
    const before = new Set(['uvod']);
    const after = applyEntries(before, [
      { id: 'uvod', isIntersecting: false },
      { id: 'o-mne', isIntersecting: true },
    ]);
    expect([...after]).toEqual(['o-mne']);
    expect([...before]).toEqual(['uvod']);
  });

  it('walks down the page: uvod, o-mne, portfolio', () => {
    let visible = new Set<string>();
    visible = applyEntries(visible, [{ id: 'uvod', isIntersecting: true }]);
    expect(pickCurrent(order, visible)).toBe('uvod');
    visible = applyEntries(visible, [{ id: 'o-mne', isIntersecting: true }, { id: 'uvod', isIntersecting: false }]);
    expect(pickCurrent(order, visible)).toBe('o-mne');
    visible = applyEntries(visible, [{ id: 'portfolio', isIntersecting: true }, { id: 'o-mne', isIntersecting: false }]);
    expect(pickCurrent(order, visible)).toBe('portfolio');
  });
});
