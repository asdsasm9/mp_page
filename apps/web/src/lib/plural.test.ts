import { describe, expect, it } from 'vitest';
import { plural, pluralForm } from './plural';

const F = { one: 'svatba', few: 'svatby', many: 'svateb' } as const;

describe('Czech plural', () => {
  it.each([
    [1, 'svatba'],
    [2, 'svatby'],
    [4, 'svatby'],
    [5, 'svateb'],
    [11, 'svateb'],
    [22, 'svateb'],
    [0, 'svateb'],
    [100, 'svateb'],
  ])('%i -> %s', (n, form) => {
    expect(pluralForm(n, F)).toBe(form);
  });

  it('prefixes the number', () => {
    expect(plural(4, F)).toBe('4 svatby');
  });
});
