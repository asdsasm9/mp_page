/**
 * Image variant planning and the variants jsonb shape.
 *
 * Known limitation (accepted for v1, the CONTENT-MAPPING rule): WebP tiers are only the
 * values of 480/720/960/1600/2400 that fit inside the master width, so a 1500 px wide master
 * gets no tier between 960 and 1500. AVIF is not planned (D-9).
 * The 720 tier (WP-03b) is required for new uploads; rows stored before it stay valid
 * without it (they are never re-validated against the plan).
 */
import { z } from 'zod';

export const MASTER_MAX_EDGE = 3000;
/** The one and only tier list; keys.ts and the zod schemas derive from it. */
export const WEBP_TIER_VALUES = [480, 720, 960, 1600, 2400] as const;
export const JPEG_WIDTH = 1600;
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export interface Size {
  w: number;
  h: number;
}

/** Scale so the long edge is at most `max`, round to integers, never upscale. */
export function fitWithin(w: number, h: number, max: number = MASTER_MAX_EDGE): Size {
  const long = Math.max(w, h);
  if (long <= max) return { w, h };
  const scale = max / long;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

export interface OgPlan extends Size {
  /** Centred crop rectangle in master coordinates. */
  crop: { x: number; y: number; w: number; h: number };
}

export interface VariantPlan {
  master: Size;
  webp: Array<Size & { tier: number }>;
  jpeg: Size;
  og: OgPlan;
}

function scaledHeight(w: number, masterW: number, masterH: number): number {
  return Math.max(1, Math.round((w * masterH) / masterW));
}

export function variantPlan(masterW: number, masterH: number): VariantPlan {
  const tiers: number[] = WEBP_TIER_VALUES.filter((t) => t <= masterW);
  const webp =
    tiers.length > 0
      ? tiers.map((t) => ({ tier: t, w: t, h: scaledHeight(t, masterW, masterH) }))
      : [{ tier: WEBP_TIER_VALUES[0] as number, w: masterW, h: masterH }];

  const jw = Math.min(JPEG_WIDTH, masterW);
  const jpeg = { w: jw, h: scaledHeight(jw, masterW, masterH) };

  // Largest 1200:630 rectangle inside the master, centred.
  let cw: number;
  let ch: number;
  if (masterW * OG_HEIGHT >= masterH * OG_WIDTH) {
    ch = masterH;
    cw = Math.min(masterW, Math.round((masterH * OG_WIDTH) / OG_HEIGHT));
  } else {
    cw = masterW;
    ch = Math.min(masterH, Math.round((masterW * OG_HEIGHT) / OG_WIDTH));
  }
  const crop = {
    x: Math.floor((masterW - cw) / 2),
    y: Math.floor((masterH - ch) / 2),
    w: cw,
    h: ch,
  };
  const og: OgPlan = cw > OG_WIDTH ? { w: OG_WIDTH, h: OG_HEIGHT, crop } : { w: cw, h: ch, crop };

  return { master: { w: masterW, h: masterH }, webp, jpeg, og };
}

// ---------------------------------------------------------------- variants jsonb

const posInt = z.number().int().positive();
const bytes = z.number().int().nonnegative();
/** Union of literals derived from WEBP_TIER_VALUES (never listed twice). */
export const WebpTierSchema = z.union(
  WEBP_TIER_VALUES.map((t) => z.literal(t)) as unknown as [
    z.ZodLiteral<(typeof WEBP_TIER_VALUES)[number]>,
    z.ZodLiteral<(typeof WEBP_TIER_VALUES)[number]>,
    ...z.ZodLiteral<(typeof WEBP_TIER_VALUES)[number]>[],
  ],
);
const tier = WebpTierSchema;

const dims = z.object({ w: posInt, h: posInt, bytes }).strict();

export const PhotoVariantsSchema = z
  .object({
    master: dims,
    webp: z.array(dims.extend({ tier }).strict()).min(1),
    jpeg: dims,
    og: dims,
  })
  .strict()
  .refine((v) => v.webp.every((e, i) => i === 0 || e.tier > v.webp[i - 1]!.tier), {
    message: 'webp tiers must be strictly ascending',
    path: ['webp'],
  });

export type PhotoVariants = z.infer<typeof PhotoVariantsSchema>;

/** The total that photos.bytes_total must equal. */
export function sumBytes(v: PhotoVariants): number {
  return v.master.bytes + v.webp.reduce((a, e) => a + e.bytes, 0) + v.jpeg.bytes + v.og.bytes;
}

// ---------------------------------------------------------------- byte estimate
// Calibration: the legacy site's files average roughly 1000 KB for 2000x2000 (AUDIT.md),
// i.e. about 0.25 bytes per pixel for a quality ~80 JPEG. legacy-photos.json does not exist
// yet (WP2-11); recalibrate from it later if the sanity bound test drifts.
// MASTERPLAN expects about 2 to 2.5 MB per photo in total; the figures below are slightly pessimistic.
// WP-03b: the 720 tier adds ~41 KB to the estimate at 0.12 B/px (the real sharp q70 file is ~95 KB),
// i.e. +2 to 4.5% storage per photo, still under the 9.5 GB guard. WEBP_BYTES_PER_PIXEL is left
// unchanged; the sanity-bound test keeps a 3000x2000 estimate between 2.0 and 3.0 MB (about 2.8 MB).
export const MASTER_JPEG_BYTES_PER_PIXEL = 0.25;
export const WEBP_BYTES_PER_PIXEL = 0.12;
export const JPEG_1600_BYTES_PER_PIXEL = 0.22;
export const OG_JPEG_BYTES_PER_PIXEL = 0.18;

/** Pessimistic pre-check for the browser. Not authoritative: the real sizes come from the encoder. */
export function estimateBytes(masterW: number, masterH: number): number {
  const p = variantPlan(masterW, masterH);
  const px = (s: Size) => s.w * s.h;
  const total =
    px(p.master) * MASTER_JPEG_BYTES_PER_PIXEL +
    p.webp.reduce((a, e) => a + px(e) * WEBP_BYTES_PER_PIXEL, 0) +
    px(p.jpeg) * JPEG_1600_BYTES_PER_PIXEL +
    px(p.og) * OG_JPEG_BYTES_PER_PIXEL;
  return Math.ceil(total);
}
