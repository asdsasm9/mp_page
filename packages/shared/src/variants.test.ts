import { describe, expect, it } from 'vitest';
import {
  PhotoVariantsSchema,
  estimateBytes,
  fitWithin,
  sumBytes,
  variantPlan,
  type PhotoVariants,
} from './variants';

describe('fitWithin', () => {
  it('scales the long edge to 3000', () => {
    expect(fitWithin(4000, 3000)).toEqual({ w: 3000, h: 2250 });
    expect(fitWithin(3000, 6000)).toEqual({ w: 1500, h: 3000 });
  });
  it('never upscales', () => {
    expect(fitWithin(2000, 3000)).toEqual({ w: 2000, h: 3000 });
    expect(fitWithin(300, 200)).toEqual({ w: 300, h: 200 });
  });
});

describe('variantPlan examples', () => {
  it('4000x3000 -> master 3000x2250 with all four tiers', () => {
    const m = fitWithin(4000, 3000);
    const p = variantPlan(m.w, m.h);
    expect(p.master).toEqual({ w: 3000, h: 2250 });
    expect(p.webp.map((e) => e.tier)).toEqual([480, 960, 1600, 2400]);
    expect(p.webp[0]).toEqual({ tier: 480, w: 480, h: 360 });
    expect(p.jpeg).toEqual({ w: 1600, h: 1200 });
  });
  it('2000x3000 -> master 2000x3000, tiers 480/960/1600', () => {
    const m = fitWithin(2000, 3000);
    expect(m).toEqual({ w: 2000, h: 3000 });
    const p = variantPlan(m.w, m.h);
    expect(p.webp.map((e) => e.tier)).toEqual([480, 960, 1600]);
    expect(p.webp[2]).toEqual({ tier: 1600, w: 1600, h: 2400 });
  });
  it('300x200 -> tier 480 with actual size 300x200, jpeg 300x200', () => {
    const p = variantPlan(300, 200);
    expect(p.webp).toEqual([{ tier: 480, w: 300, h: 200 }]);
    expect(p.jpeg).toEqual({ w: 300, h: 200 });
  });
  it('1500 wide master has no tier between 960 and 1500 (documented limitation)', () => {
    expect(variantPlan(1500, 1000).webp.map((e) => e.tier)).toEqual([480, 960]);
  });
});

describe('variantPlan properties', () => {
  const sizes: Array<[number, number]> = [];
  for (let i = 0; i < 200; i++) {
    // deterministic pseudo-random sizes covering tiny to huge, wide and tall
    const w = 50 + ((i * 7919) % 5950);
    const h = 50 + ((i * 104729 + 13) % 5950);
    sizes.push([w, h]);
  }
  it('has 200 sizes', () => expect(sizes).toHaveLength(200));

  it.each(sizes)('%i x %i', (rw, rh) => {
    const m = fitWithin(rw, rh);
    expect(m.w).toBeLessThanOrEqual(rw);
    expect(m.h).toBeLessThanOrEqual(rh);
    expect(Math.max(m.w, m.h)).toBeLessThanOrEqual(3000);
    const p = variantPlan(m.w, m.h);
    for (const e of [...p.webp, p.jpeg, p.og]) {
      expect(e.w).toBeLessThanOrEqual(m.w);
      expect(e.h).toBeLessThanOrEqual(m.h);
      expect(e.w).toBeGreaterThan(0);
      expect(e.h).toBeGreaterThan(0);
    }
    const tiers = p.webp.map((e) => e.tier);
    expect([...tiers].sort((a, b) => a - b)).toEqual(tiers);
    for (const e of [...p.webp, p.jpeg]) {
      expect(Math.abs(e.h - (e.w * m.h) / m.w)).toBeLessThanOrEqual(1);
    }
    // OG crop: centred, aspect 1200:630 within rounding
    const { crop } = p.og;
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.w).toBeLessThanOrEqual(m.w);
    expect(crop.y + crop.h).toBeLessThanOrEqual(m.h);
    expect(Math.abs(crop.x - (m.w - crop.w - crop.x))).toBeLessThanOrEqual(1);
    expect(Math.abs(crop.y - (m.h - crop.h - crop.y))).toBeLessThanOrEqual(1);
    // aspect 1200:630 within rounding (half a pixel on the derived edge)
    expect(Math.abs(crop.w * 630 - crop.h * 1200)).toBeLessThanOrEqual(600);
  });

  it('OG crop is the largest 1200:630 rectangle and scales to 1200x630 for big masters', () => {
    const p = variantPlan(3000, 2250);
    expect(p.og.crop).toEqual({ x: 0, y: Math.floor((2250 - 1575) / 2), w: 3000, h: 1575 });
    expect(p.og.w).toBe(1200);
    expect(p.og.h).toBe(630);
    const tall = variantPlan(2000, 3000);
    expect(tall.og.crop.w).toBe(2000);
    expect(tall.og.crop.h).toBe(1050);
    expect(tall.og.crop.y).toBe(975);
    const small = variantPlan(600, 600);
    expect(small.og).toMatchObject({ w: 600, h: 315 });
  });
});

const sample: PhotoVariants = {
  master: { w: 3000, h: 2000, bytes: 1_000_000 },
  webp: [
    { tier: 480, w: 480, h: 320, bytes: 20_000 },
    { tier: 960, w: 960, h: 640, bytes: 80_000 },
  ],
  jpeg: { w: 1600, h: 1067, bytes: 300_000 },
  og: { w: 1200, h: 630, bytes: 100_000 },
};

describe('PhotoVariantsSchema', () => {
  it('accepts a valid sample', () => {
    expect(PhotoVariantsSchema.safeParse(sample).success).toBe(true);
  });
  it('rejects an empty webp list', () => {
    expect(PhotoVariantsSchema.safeParse({ ...sample, webp: [] }).success).toBe(false);
  });
  it('rejects descending or duplicate tiers', () => {
    const [a, b] = sample.webp;
    expect(PhotoVariantsSchema.safeParse({ ...sample, webp: [b, a] }).success).toBe(false);
    expect(PhotoVariantsSchema.safeParse({ ...sample, webp: [a, a] }).success).toBe(false);
  });
  it('rejects negative bytes, non-integer sizes and zero dimensions', () => {
    expect(PhotoVariantsSchema.safeParse({ ...sample, jpeg: { ...sample.jpeg, bytes: -1 } }).success).toBe(false);
    expect(PhotoVariantsSchema.safeParse({ ...sample, jpeg: { ...sample.jpeg, w: 1.5 } }).success).toBe(false);
    expect(PhotoVariantsSchema.safeParse({ ...sample, master: { ...sample.master, h: 0 } }).success).toBe(false);
  });
  it('rejects a missing og or jpeg, and unknown keys', () => {
    const { og: _og, ...noOg } = sample;
    const { jpeg: _jpeg, ...noJpeg } = sample;
    expect(PhotoVariantsSchema.safeParse(noOg).success).toBe(false);
    expect(PhotoVariantsSchema.safeParse(noJpeg).success).toBe(false);
    expect(PhotoVariantsSchema.safeParse({ ...sample, avif: [] }).success).toBe(false);
  });
  it('rejects an unknown tier', () => {
    expect(
      PhotoVariantsSchema.safeParse({ ...sample, webp: [{ tier: 700, w: 700, h: 400, bytes: 1 }] }).success,
    ).toBe(false);
  });
});

describe('sumBytes', () => {
  it('equals the manual sum', () => {
    expect(sumBytes(sample)).toBe(1_000_000 + 20_000 + 80_000 + 300_000 + 100_000);
  });
});

describe('estimateBytes', () => {
  it('3000x2000 is between 1.5 MB and 3.5 MB', () => {
    const e = estimateBytes(3000, 2000);
    expect(e).toBeGreaterThan(1_500_000);
    expect(e).toBeLessThan(3_500_000);
  });
  it('is an integer and grows with size', () => {
    expect(Number.isInteger(estimateBytes(1000, 700))).toBe(true);
    expect(estimateBytes(3000, 2000)).toBeGreaterThan(estimateBytes(1000, 700));
  });
});
