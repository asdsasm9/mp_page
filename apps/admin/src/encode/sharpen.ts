/**
 * Unsharp mask on luma (WP-10 plan 3.2). Pure TypeScript, no dependency, no ctx.filter (Safari). Only the luma
 * changes: the same delta is added to R, G and B, so hue and saturation stay put. Works in place on RGBA bytes and
 * yields to the event loop between row bands so a big surface does not freeze the page.
 */

/** Blur radius (gaussian sigma, px) of the mask. */
export const SHARPEN_RADIUS = 0.6;

/** Amount by WebP tier width; master and the 1600 JPEG are not sharpened. */
export function webpSharpenAmount(width: number): number {
  if (width <= 960) return 0.45;
  if (width <= 1600) return 0.25;
  if (width <= 2400) return 0.12;
  return 0;
}
export const OG_SHARPEN_AMOUNT = 0.25;

const BAND_ROWS = 128;
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** 3-tap gaussian weights for SHARPEN_RADIUS: [side, centre, side], summing to 1. */
function kernel(radius: number): [number, number] {
  const side = Math.exp(-1 / (2 * radius * radius));
  const norm = 1 + 2 * side;
  return [side / norm, 1 / norm];
}

/**
 * Sharpens `data` (RGBA, w*h*4) in place: Y' = Y + amount * (Y - blur(Y)), applied equally to R, G, B.
 * amount <= 0 leaves the data untouched. Edge pixels repeat.
 */
export async function sharpenLuma(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  amount: number,
  signal?: AbortSignal,
  radius = SHARPEN_RADIUS,
): Promise<void> {
  if (!(amount > 0) || w < 1 || h < 1 || data.length < w * h * 4) return;
  const [side, centre] = kernel(radius);
  const luma = new Float32Array(w * h);
  for (let i = 0, p = 0; i < luma.length; i++, p += 4) luma[i] = 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!;

  // Horizontal pass into `tmp`.
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const l = luma[row + (x > 0 ? x - 1 : 0)]!;
      const r = luma[row + (x < w - 1 ? x + 1 : w - 1)]!;
      tmp[row + x] = side * l + centre * luma[row + x]! + side * r;
    }
    if (y % BAND_ROWS === BAND_ROWS - 1) {
      if (signal?.aborted) return;
      await yieldToLoop();
    }
  }

  // Vertical pass, applied straight to the pixels.
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : 0) * w;
    const mid = y * w;
    const down = (y < h - 1 ? y + 1 : h - 1) * w;
    for (let x = 0; x < w; x++) {
      const blurred = side * tmp[up + x]! + centre * tmp[mid + x]! + side * tmp[down + x]!;
      const delta = amount * (luma[mid + x]! - blurred);
      const p = (mid + x) * 4;
      data[p] = data[p]! + delta; // Uint8ClampedArray rounds and clamps
      data[p + 1] = data[p + 1]! + delta;
      data[p + 2] = data[p + 2]! + delta;
    }
    if (y % BAND_ROWS === BAND_ROWS - 1) {
      if (signal?.aborted) return;
      await yieldToLoop();
    }
  }
}
