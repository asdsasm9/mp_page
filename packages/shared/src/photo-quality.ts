/**
 * Photo quality contract (WP-10 step 2). Pure data and functions, no I/O.
 * Numbers are from plans/WP-10-photo-quality.md section 3.1 with the T-265 measured overrides
 * (provisional: legacy-only samples, final values after Adam's originals).
 */
import { variantPlan, type PhotoVariants } from './variants';

/**
 * A master whose long edge is below this is "low resolution" ("Nízké rozlišení").
 * Adam may tune this later (plan question 3: 2000 recommended, 1600 or 2400 possible).
 */
export const DETAIL_MIN_LONG_EDGE = 2000;

/** Largest accepted input file (per-part upload cap maxUploadBytes stays separate). */
export const MAX_INPUT_FILE_BYTES = 50 * 1024 * 1024;
/** Largest accepted decoded size, in megapixels. */
export const MAX_INPUT_MEGAPIXELS_DESKTOP = 64;
export const MAX_INPUT_MEGAPIXELS_TOUCH = 40;

export interface QualityEntry {
  /** Encoder quality to start with (0..1). */
  start: number;
  /** Byte cap that triggers the adaptive step-down. */
  capBytes: number;
  /** Never go below this quality (D-8). */
  floor: number;
}

/** Adaptive step: over cap -> lower quality by this much, at most MAX_QUALITY_RETRIES times. */
export const QUALITY_STEP = 0.04;
export const MAX_QUALITY_RETRIES = 3;

const KB = 1000;
const MB = 1000 * KB;

export const QUALITY_TABLE = {
  webp480: { start: 0.74, capBytes: 40 * KB, floor: 0.6 },
  webp720: { start: 0.68, capBytes: 80 * KB, floor: 0.6 },
  webp960: { start: 0.66, capBytes: 150 * KB, floor: 0.6 },
  webp1600: { start: 0.8, capBytes: 320 * KB, floor: 0.7 },
  webp2400: { start: 0.8, capBytes: 700 * KB, floor: 0.7 },
  jpeg1600: { start: 0.82, capBytes: 500 * KB, floor: 0.75 },
  og: { start: 0.82, capBytes: 160 * KB, floor: 0.7 },
  master: { start: 0.9, capBytes: 5 * MB, floor: 0.8 },
} as const satisfies Record<string, QualityEntry>;

export type QualityKey = keyof typeof QUALITY_TABLE;

/** Table key for a WebP tier width. */
export function webpQualityKey(tier: number): QualityKey | undefined {
  const key = `webp${tier}`;
  return key in QUALITY_TABLE ? (key as QualityKey) : undefined;
}

// ---------------------------------------------------------------- verdict

export type PhotoVerdict = 'low' | 'good' | 'missing';

export interface PhotoVerdictResult {
  verdict: PhotoVerdict;
  /** Names of planned variants that are absent, e.g. ['webp720']. Empty unless verdict is 'missing'. */
  missing: string[];
}

/**
 * Verdict for a stored photo. `width`/`height` are the master dimensions.
 * A planned tier (variantPlan) or the jpeg/og variant being absent -> 'missing' (this includes
 * rows stored before the 720 tier); otherwise a master long edge below DETAIL_MIN_LONG_EDGE -> 'low'.
 */
export function photoVerdict(
  variants: Pick<PhotoVariants, 'webp'> & Partial<Pick<PhotoVariants, 'jpeg' | 'og'>>,
  width: number,
  height: number,
): PhotoVerdictResult {
  const plan = variantPlan(width, height);
  const have = new Set<number>(variants.webp.map((e) => e.tier));
  const missing: string[] = plan.webp.filter((e) => !have.has(e.tier)).map((e) => `webp${e.tier}`);
  if (!variants.jpeg) missing.push('jpeg');
  if (!variants.og) missing.push('og');
  if (missing.length > 0) return { verdict: 'missing', missing };
  if (Math.max(width, height) < DETAIL_MIN_LONG_EDGE) return { verdict: 'low', missing: [] };
  return { verdict: 'good', missing: [] };
}
