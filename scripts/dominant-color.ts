// Shared script helper: dominant colour of an image (used by dev-images and migrate-legacy, plan WP-06 3.5).
import sharp from 'sharp';

/** Mean colour of an image as lowercase #rrggbb (sharp stats on a 32 px downscale); the same idea the WP-5 encoder uses. */
export async function dominantColorOf(input: Buffer): Promise<string> {
  const { channels } = await sharp(input).resize({ width: 32, height: 32, fit: 'inside' }).removeAlpha().toColourspace('srgb').stats();
  const hex = (c: { mean: number } | undefined) => Math.round(c?.mean ?? 0).toString(16).padStart(2, '0');
  return `#${hex(channels[0])}${hex(channels[1])}${hex(channels[2])}`;
}
