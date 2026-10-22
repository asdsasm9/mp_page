import { describe, expect, it } from 'vitest';
import {
  RESERVED_CATEGORY_SLUGS,
  isReservedCategorySlug,
  isValidSlug,
  slugify,
  uniqueSlug,
} from './slug';

const LEGACY_IDS = [
  'frankovi', 'hradsti', 'sedlakovi', 'suranovi', 'anez', 'lucka', 'lukas',
  'mia', 'pati', 'pati2', 'pavla_rafael', 'helis_tom', 'lucka_filip',
];

describe('slugify', () => {
  it.each([
    ['Michal & Rozárka', 'michal-rozarka'],
    ['Pati kavárna', 'pati-kavarna'],
    ['Párové focení', 'parove-foceni'],
    ['Příliš žluťoučký kůň', 'prilis-zlutoucky-kun'],
    ['  --Hello!!!   World??  ', 'hello-world'],
    ['a...b___c', 'a-b-c'],
    ['Broňa a Prokop', 'brona-a-prokop'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('caps at 60 characters and never ends with a hyphen', () => {
    const out = slugify('a'.repeat(100));
    expect(out).toHaveLength(60);
    const cut = slugify(`${'a'.repeat(59)} bbb`);
    expect(cut).toBe('a'.repeat(59));
    expect(cut.endsWith('-')).toBe(false);
  });
});

describe('isValidSlug', () => {
  it.each([
    ['svatby', {}, true],
    ['o-mne', {}, true],
    ['a', {}, false],
    ['ab', {}, true],
    ['a'.repeat(61), {}, false],
    ['a'.repeat(60), {}, true],
    ['Abc', {}, false],
    ['-ab', {}, false],
    ['ab-', {}, false],
    ['a--b', {}, false],
    ['pavla_rafael', {}, false],
    ['pavla_rafael', { legacy: true }, true],
    ['a__b', { legacy: true }, false],
    ['_ab', { legacy: true }, false],
    ['ab cd', { legacy: true }, false],
  ] as const)('%s %j -> %s', (s, opts, expected) => {
    expect(isValidSlug(s, opts)).toBe(expected);
  });

  it('accepts all 13 legacy ids with legacy:true', () => {
    expect(LEGACY_IDS).toHaveLength(13);
    for (const id of LEGACY_IDS) expect(isValidSlug(id, { legacy: true })).toBe(true);
  });

  it('rejects pavla_rafael in strict mode', () => {
    expect(isValidSlug('pavla_rafael')).toBe(false);
  });
});

describe('uniqueSlug', () => {
  it('returns base when free, then -2, -3', () => {
    expect(uniqueSlug('mia', [])).toBe('mia');
    expect(uniqueSlug('mia', ['mia'])).toBe('mia-2');
    expect(uniqueSlug('mia', new Set(['mia', 'mia-2']))).toBe('mia-3');
  });
  it('stays within 60 characters', () => {
    const base = 'a'.repeat(60);
    const out = uniqueSlug(base, [base]);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith('-2')).toBe(true);
  });
});

describe('reserved slugs', () => {
  it('exports the 14 reserved slugs', () => {
    expect(RESERVED_CATEGORY_SLUGS).toHaveLength(14);
    expect(isReservedCategorySlug('kontakt')).toBe(true);
    expect(isReservedCategorySlug('svatby')).toBe(false);
  });
});
