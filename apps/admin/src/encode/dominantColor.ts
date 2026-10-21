/**
 * Dominant colour from a 16x16 RGBA sample (plan 4.7). Pure and deterministic.
 * Deliberately differs from scripts/dominant-color.ts (sharp stats on a 32 px downscale, plain mean): this one runs in
 * the browser on a canvas sample, weights pixels by alpha, and damps near-white/near-black border pixels so frames and
 * letterboxing do not skew the colour. The script's plain mean is enough for bulk dev/legacy imports.
 */
import type { Rgba } from './surface';

export const FALLBACK_COLOR = '#808080';
export const SAMPLE_EDGE = 16;
/** Border pixels that are near-white or near-black (frames, letterboxing) count this much. */
const BORDER_DAMPING = 0.1;
const NEAR_WHITE = 240;
const NEAR_BLACK = 15;

const hex = (n: number): string => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, '0');

/** Mean colour weighted by alpha; near-white and near-black pixels on the outer ring are damped. Lowercase `#rrggbb`. */
export function dominantColorOf(image: Rgba): string {
  const { data, width, height } = image;
  if (!(width > 0) || !(height > 0) || !data || data.length < width * height * 4) return FALLBACK_COLOR;
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const pr = data[i] as number;
      const pg = data[i + 1] as number;
      const pb = data[i + 2] as number;
      const pa = data[i + 3] as number;
      if (![pr, pg, pb, pa].every(Number.isFinite)) continue;
      let weight = pa / 255;
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (border && (Math.min(pr, pg, pb) >= NEAR_WHITE || Math.max(pr, pg, pb) <= NEAR_BLACK)) weight *= BORDER_DAMPING;
      r += pr * weight;
      g += pg * weight;
      b += pb * weight;
      total += weight;
    }
  }
  if (!(total > 0)) return FALLBACK_COLOR;
  const out = `#${hex(r / total)}${hex(g / total)}${hex(b / total)}`;
  return /^#[0-9a-f]{6}$/.test(out) ? out : FALLBACK_COLOR;
}
