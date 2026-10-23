import { describe, expect, it } from 'vitest';
import {
  DETAIL_MIN_LONG_EDGE,
  MAX_INPUT_FILE_BYTES,
  MAX_INPUT_MEGAPIXELS_DESKTOP,
  MAX_INPUT_MEGAPIXELS_TOUCH,
  QUALITY_TABLE,
  photoVerdict,
  webpQualityKey,
} from './photo-quality';
import { fitWithin, variantPlan, type PhotoVariants } from './variants';

function full(w: number, h: number, opts: { skipTiers?: number[] } = {}): PhotoVariants {
  const p = variantPlan(w, h);
  const d = (s: { w: number; h: number }) => ({ w: s.w, h: s.h, bytes: 1000 });
  return {
    master: d(p.master),
    webp: p.webp.filter((e) => !opts.skipTiers?.includes(e.tier)).map((e) => ({ ...d(e), tier: e.tier as 480 })),
    jpeg: d(p.jpeg),
    og: d(p.og),
  };
}

describe('constants', () => {
  it('match the plan', () => {
    expect(DETAIL_MIN_LONG_EDGE).toBe(2000);
    expect(MAX_INPUT_FILE_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_INPUT_MEGAPIXELS_DESKTOP).toBe(64);
    expect(MAX_INPUT_MEGAPIXELS_TOUCH).toBe(40);
  });
});

describe('QUALITY_TABLE', () => {
  const rows: Array<[keyof typeof QUALITY_TABLE, number, number, number]> = [
    ['webp480', 0.74, 40_000, 0.6],
    ['webp720', 0.68, 80_000, 0.6],
    ['webp960', 0.66, 150_000, 0.6],
    ['webp1600', 0.8, 320_000, 0.7],
    ['webp2400', 0.8, 700_000, 0.7],
    ['jpeg1600', 0.82, 500_000, 0.75],
    ['og', 0.82, 160_000, 0.7],
    ['master', 0.9, 5_000_000, 0.8],
  ];
  it.each(rows)('%s', (key, start, cap, floor) => {
    expect(QUALITY_TABLE[key]).toEqual({ start, capBytes: cap, floor });
    expect(QUALITY_TABLE[key].start).toBeGreaterThanOrEqual(QUALITY_TABLE[key].floor);
  });
  it('webpQualityKey maps the tiers', () => {
    expect(webpQualityKey(720)).toBe('webp720');
    expect(webpQualityKey(2400)).toBe('webp2400');
    expect(webpQualityKey(1000)).toBeUndefined();
  });
});

describe('photoVerdict', () => {
  const cases: Array<[string, number, number, number[], string, string[]]> = [
    ['1480x987 is low', 1480, 987, [], 'low', []],
    ['3000x2000 full is good', 3000, 2000, [], 'good', []],
    ['3000x2000 without 720 is missing', 3000, 2000, [720], 'missing', ['webp720']],
    ['1500x2250 portrait is good', 1500, 2250, [], 'good', []],
    ['2000x1333 is good (boundary)', 2000, 1333, [], 'good', []],
    ['1999x1333 is low (boundary)', 1999, 1333, [], 'low', []],
    ['missing wins over low', 1480, 987, [720], 'missing', ['webp720']],
  ];
  it.each(cases)('%s', (_n, w, h, skip, verdict, missing) => {
    expect(photoVerdict(full(w, h, { skipTiers: skip }), w, h)).toEqual({ verdict, missing });
  });
  it('missing jpeg and og are reported', () => {
    const v = full(3000, 2000);
    expect(photoVerdict({ webp: v.webp }, 3000, 2000)).toEqual({
      verdict: 'missing',
      missing: ['jpeg', 'og'],
    });
  });
});

describe('never upscale', () => {
  it.each([300, 479, 480, 719, 720, 1000, 1480, 1599, 1600, 2399, 2400, 3000])(
    'master width %i: no output wider than master',
    (mw) => {
      const m = fitWithin(mw, Math.round((mw * 2) / 3));
      const p = variantPlan(m.w, m.h);
      expect(p.master.w).toBeLessThanOrEqual(mw);
      for (const e of p.webp) expect(e.w).toBeLessThanOrEqual(m.w);
      expect(p.jpeg.w).toBeLessThanOrEqual(m.w);
      expect(p.og.w).toBeLessThanOrEqual(m.w);
    },
  );
});
