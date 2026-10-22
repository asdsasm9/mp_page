import { describe, expect, it } from 'vitest';
import { czechPluralIndex } from './czech-plural';

describe('czechPluralIndex', () => {
  it('picks one, few, many', () => {
    expect(czechPluralIndex(1)).toBe(0);
    expect([2, 3, 4].map(czechPluralIndex)).toEqual([1, 1, 1]);
    expect([0, 5, 11, 22, 100].map(czechPluralIndex)).toEqual([2, 2, 2, 2, 2]);
  });

  it('treats fractions and negatives as many', () => {
    expect(czechPluralIndex(1.5)).toBe(2);
    expect(czechPluralIndex(2.5)).toBe(2);
    expect(czechPluralIndex(-1)).toBe(2);
    expect(czechPluralIndex(-3)).toBe(2);
  });
});
