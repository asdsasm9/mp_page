import { describe, expect, it } from 'vitest';
import { OG_SHARPEN_AMOUNT, sharpenLuma, webpSharpenAmount } from './sharpen';

function image(w: number, h: number, px: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data.set([...px(x, y), 255], (y * w + x) * 4);
  }
  return data;
}

describe('webpSharpenAmount (plan 3.2)', () => {
  it('is 0.45 for 480-960, 0.25 for 1600, 0.12 for 2400, 0 above', () => {
    expect([480, 720, 960].map(webpSharpenAmount)).toEqual([0.45, 0.45, 0.45]);
    expect(webpSharpenAmount(1600)).toBe(0.25);
    expect(webpSharpenAmount(2400)).toBe(0.12);
    expect(webpSharpenAmount(3000)).toBe(0);
    expect(OG_SHARPEN_AMOUNT).toBe(0.25);
  });
});

describe('sharpenLuma', () => {
  it('leaves a flat image unchanged', async () => {
    const data = image(8, 8, () => [90, 120, 200]);
    const before = Uint8ClampedArray.from(data);
    await sharpenLuma(data, 8, 8, 0.45);
    expect(Array.from(data)).toEqual(Array.from(before));
  });

  it('amount 0 and invalid sizes change nothing', async () => {
    const data = image(6, 6, (x) => [x * 40, x * 40, x * 40]);
    const before = Uint8ClampedArray.from(data);
    await sharpenLuma(data, 6, 6, 0);
    await sharpenLuma(data, 0, 0, 0.45);
    expect(Array.from(data)).toEqual(Array.from(before));
  });

  it('steepens a vertical edge: dark side darker, bright side brighter, far pixels unchanged', async () => {
    const w = 12;
    const data = image(w, 4, (x) => (x < 6 ? [80, 80, 80] : [180, 180, 180]));
    await sharpenLuma(data, w, 4, 0.45);
    const at = (x: number, y = 1) => data[(y * w + x) * 4]!;
    expect(at(5)).toBeLessThan(80);
    expect(at(6)).toBeGreaterThan(180);
    expect(at(0)).toBe(80);
    expect(at(11)).toBe(180);
    expect(at(2)).toBe(80);
  });

  it('a bigger amount overshoots more (the overshoot test)', async () => {
    const make = () => image(12, 4, (x) => (x < 6 ? [80, 80, 80] : [180, 180, 180]));
    const lo = make();
    const hi = make();
    await sharpenLuma(lo, 12, 4, 0.12);
    await sharpenLuma(hi, 12, 4, 0.45);
    const over = (d: Uint8ClampedArray) => d[6 * 4]! - 180;
    expect(over(lo)).toBeGreaterThan(0);
    expect(over(hi)).toBeGreaterThan(over(lo));
    // 0.45 on a 100-level step with a 0.6 px gaussian stays a modest halo, not a blow-out
    expect(over(hi)).toBeLessThan(25);
  });

  it('changes luma only: the same delta goes to R, G and B and alpha is untouched', async () => {
    const w = 12;
    const data = image(w, 3, (x) => (x < 6 ? [60, 100, 140] : [160, 200, 240]));
    const before = Uint8ClampedArray.from(data);
    await sharpenLuma(data, w, 3, 0.45);
    const p = (1 * w + 5) * 4;
    const dr = data[p]! - before[p]!;
    expect(data[p + 1]! - before[p + 1]!).toBe(dr);
    expect(data[p + 2]! - before[p + 2]!).toBe(dr);
    expect(dr).not.toBe(0);
    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(255);
  });

  it('clamps at 0 and 255', async () => {
    const data = image(10, 3, (x) => (x < 5 ? [0, 0, 0] : [255, 255, 255]));
    await sharpenLuma(data, 10, 3, 3);
    expect(data[(1 * 10 + 4) * 4]).toBe(0);
    expect(data[(1 * 10 + 5) * 4]).toBe(255);
  });

  it('works on a 1x1 and a 1-row image', async () => {
    const one = image(1, 1, () => [10, 20, 30]);
    await sharpenLuma(one, 1, 1, 0.45);
    expect(Array.from(one)).toEqual([10, 20, 30, 255]);
    const row = image(5, 1, (x) => [x * 50, x * 50, x * 50]);
    await sharpenLuma(row, 5, 1, 0.45);
    expect(row.length).toBe(20);
  });

  it('stops early when aborted', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const data = image(4, 300, (x, y) => [(x * y) & 255, 0, 0]);
    const before = Uint8ClampedArray.from(data);
    await sharpenLuma(data, 4, 300, 0.45, ctl.signal);
    expect(Array.from(data)).toEqual(Array.from(before)); // aborted in the first (horizontal) pass, nothing written
  });
});
