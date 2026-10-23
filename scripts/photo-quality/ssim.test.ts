import { describe, expect, it } from 'vitest';
import { lumaSsim } from './ssim';

// Deterministic pseudo-random bytes (LCG), so the test never flakes.
function noise(len: number, seed: number): Uint8Array {
  const out = new Uint8Array(len);
  let s = seed;
  for (let i = 0; i < len; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

describe('lumaSsim', () => {
  const w = 40;
  const h = 30;
  const base = noise(w * h, 7);

  it('is exactly 1.0 for identical images', () => {
    expect(lumaSsim(base, base, w, h)).toBe(1);
  });

  it('is 1.0 for two identical flat images', () => {
    const flat = new Uint8Array(w * h).fill(128);
    expect(lumaSsim(flat, flat, w, h)).toBe(1);
  });

  it('is below 1 for a noisy copy and lower for more noise', () => {
    const small = base.map((v, i) => Math.min(255, Math.max(0, v + ((i * 37) % 9) - 4)));
    const big = base.map((v, i) => Math.min(255, Math.max(0, v + ((i * 91) % 81) - 40)));
    const s1 = lumaSsim(base, small, w, h);
    const s2 = lumaSsim(base, big, w, h);
    expect(s1).toBeLessThan(1);
    expect(s2).toBeLessThan(s1);
    expect(s2).toBeGreaterThan(-1);
  });

  it('is symmetric', () => {
    const other = noise(w * h, 99);
    expect(lumaSsim(base, other, w, h)).toBeCloseTo(lumaSsim(other, base, w, h), 12);
  });

  it('handles images smaller than the window and rejects a size mismatch', () => {
    const tiny = noise(9, 3);
    expect(lumaSsim(tiny, tiny, 3, 3)).toBe(1);
    expect(() => lumaSsim(base, base, w + 1, h)).toThrow(RangeError);
  });
});
