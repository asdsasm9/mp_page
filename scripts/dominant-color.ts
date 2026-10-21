// Shared script helper: dominant colour of an image (used by dev-images and migrate-legacy, plan WP-06 3.5).
import sharp from 'sharp';

/**
 * Mean colour of an image as lowercase #rrggbb: sharp stats on a 32 px downscale, plain per-channel mean, alpha removed.
 * This is NOT the same algorithm as the admin encoder (apps/admin/src/encode/dominantColor.ts), which samples 16 px,
 * weights by alpha and damps near-white/near-black border pixels. The two can give slightly different colours for the
 * same photo. That is accepted: this script only seeds dev images and migrated legacy photos in bulk with sharp, where a
 * simple mean is enough; the admin version runs in the browser on a canvas sample and must handle frames/letterboxing.
 */
export async function dominantColorOf(input: Buffer): Promise<string> {
  const { channels } = await sharp(input).resize({ width: 32, height: 32, fit: 'inside' }).removeAlpha().toColourspace('srgb').stats();
  const hex = (c: { mean: number } | undefined) => Math.round(c?.mean ?? 0).toString(16).padStart(2, '0');
  return `#${hex(channels[0])}${hex(channels[1])}${hex(channels[2])}`;
}
