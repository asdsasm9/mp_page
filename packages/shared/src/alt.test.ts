import { describe, expect, it } from 'vitest';
import { defaultAlt, effectiveAlt, findDuplicateAlts, validateAlt } from './alt';

describe('defaultAlt', () => {
  it('builds the SEO.md example', () => {
    expect(
      defaultAlt({ albumTitle: 'Adam & Eliška', categoryKey: 'svatby', n: 12, total: 44 }),
    ).toBe('Adam & Eliška – svatba, fotografie 12 z 44');
  });
  it('maps portrety and parove-foceni, falls back to lowercased name', () => {
    expect(defaultAlt({ albumTitle: 'Mia', categoryKey: 'portrety', n: 1, total: 2 })).toBe(
      'Mia – portrét, fotografie 1 z 2',
    );
    expect(defaultAlt({ albumTitle: 'X', categoryKey: 'parove-foceni', n: 1, total: 1 })).toBe(
      'X – párové focení, fotografie 1 z 1',
    );
    expect(defaultAlt({ albumTitle: 'X', categoryKey: 'Rodinné', n: 3, total: 4 })).toBe(
      'X – rodinné, fotografie 3 z 4',
    );
  });
});

describe('validateAlt', () => {
  it.each(['IMG_001.jpg', 'Photo 3', 'fotky_web/a/1.jpg', 'image of x', 'Foto 1', 'Obrázek 2', 'a\\b', 'x.PNG'])(
    'rejects %s',
    (alt) => {
      const r = validateAlt(alt);
      expect(r.ok).toBe(false);
      expect(r.problems.length).toBeGreaterThan(0);
    },
  );
  it('accepts a good alt without warnings', () => {
    const r = validateAlt('Adam & Eliška – svatba, fotografie 12 z 44');
    expect(r).toEqual({ ok: true, problems: [], warnings: [] });
  });
  it('126 characters is a warning, not an error', () => {
    const r = validateAlt('a'.repeat(126));
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(1);
  });
  it('125 characters has no warning', () => {
    expect(validateAlt('a'.repeat(125)).warnings).toHaveLength(0);
  });
  it('300 ok, 301 characters is an error', () => {
    expect(validateAlt('a'.repeat(300)).ok).toBe(true);
    const r = validateAlt('a'.repeat(301));
    expect(r.ok).toBe(false);
    expect(r.warnings).toHaveLength(0);
  });
});

describe('effectiveAlt', () => {
  const ctx = { albumTitle: 'Mia', categoryKey: 'portrety', n: 2, total: 5 };
  it('uses stored alt when non-empty', () => {
    expect(effectiveAlt({ alt: '  Mia v lese ' }, ctx)).toBe('Mia v lese');
  });
  it('falls back to default for null, empty and whitespace', () => {
    const d = defaultAlt(ctx);
    expect(effectiveAlt({ alt: null }, ctx)).toBe(d);
    expect(effectiveAlt({ alt: '' }, ctx)).toBe(d);
    expect(effectiveAlt({ alt: '   ' }, ctx)).toBe(d);
  });
});

describe('findDuplicateAlts', () => {
  it('groups equal non-empty alts', () => {
    const photos = [
      { id: 1, alt: 'a' },
      { id: 2, alt: 'b' },
      { id: 3, alt: 'a' },
      { id: 4, alt: '' },
      { id: 5, alt: null },
      { id: 6, alt: '' },
    ];
    const groups = findDuplicateAlts(photos);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.map((p) => p.id)).toEqual([1, 3]);
  });
  it('returns nothing when unique', () => {
    expect(findDuplicateAlts([{ alt: 'a' }, { alt: 'b' }])).toEqual([]);
  });
});
