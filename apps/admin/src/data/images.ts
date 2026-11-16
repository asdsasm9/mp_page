/** URLs of photo files on the public image host. Keys come from the shared helpers (derived from the photo id only). */
import { isValidPhotoId, webpKey, type WebpTier } from '@mp/shared';

/** The WebP of a photo at the given width tier, or null for an id that is not a valid photo id. */
export function photoWebpUrl(imgBase: string, photoId: string, tier: WebpTier = 480): string | null {
  return isValidPhotoId(photoId) ? `${imgBase}/${webpKey(photoId, tier)}` : null;
}

/** `srcset` of width descriptors (the tier is the file's pixel width), or null for an invalid photo id. */
export function photoWebpSrcSet(imgBase: string, photoId: string, tiers: readonly WebpTier[]): string | null {
  if (!isValidPhotoId(photoId)) return null;
  return tiers.map((tier) => `${imgBase}/${webpKey(photoId, tier)} ${tier}w`).join(', ');
}

/**
 * Photos are shown cropped to a box (object-fit: cover). A landscape photo is scaled until its HEIGHT fills the box, so
 * the file has to be as wide as height x aspect, not as wide as the box (a 3:2 photo in a 3:4 tile is 2x the tile width).
 * COVER_ASPECT is the width/height of the widest ordinary photo (3:2); wider panoramas stay a little soft.
 */
export const COVER_ASPECT = 1.5;

/** CSS px width a cover-cropped photo needs in a box of the given CSS size (the browser multiplies by the pixel ratio). */
export function coverWidth(boxWidth: number, boxHeight: number): number {
  return Math.ceil(Math.max(boxWidth, boxHeight * COVER_ASPECT));
}

type Place = { tiers: readonly WebpTier[]; sizes: string };

/**
 * Where each place shows photos: the tiers offered to the browser (the first one is the `src` fallback) and the `sizes`
 * it chooses from. Before T-351 all three used the 480 px tier only, which is 160 px short on a 3:4 tile at 1280 and
 * half of what a 2x screen needs in the strip and picker.
 */
export const PHOTO_IMG = {
  /** Post editor strip: 72 x 96 px box (4.5 rem wide, 3:4), shown at 2x and 3x on phones, so never the 480. */
  strip: { tiers: [720, 960], sizes: `${coverWidth(72, 96) * 2}px` },
  /** Picker tile: square, two columns in a phone dialog (about 150 px) and three on a wide one (about 165 px). */
  picker: { tiers: [720, 960], sizes: `(min-width: 40rem) ${coverWidth(165, 165) * 2}px, ${coverWidth(150, 150) * 2}px` },
  /** Instagram grid tile: 3:4, one third of the page (about 360 x 480 px at 1280, about 110 x 147 px on a phone). */
  grid: {
    tiers: [480, 720, 960],
    sizes: `(min-width: 64rem) ${coverWidth(360, 480)}px, (min-width: 40rem) ${coverWidth(230, 307)}px, ${coverWidth(110, 147)}px`,
  },
} as const satisfies Record<string, Place>;

/** Props for a cover-cropped `<img>` of a photo at one of the places above, or null for an invalid photo id. */
export function photoImgProps(imgBase: string, photoId: string, place: keyof typeof PHOTO_IMG) {
  const { tiers, sizes } = PHOTO_IMG[place];
  const src = photoWebpUrl(imgBase, photoId, tiers[0]);
  const srcSet = photoWebpSrcSet(imgBase, photoId, tiers);
  return src && srcSet ? { src, srcSet, sizes } : null;
}

/**
 * onError of an image with a `srcset`: tiers only exist up to the master width, so a small master has no 720 or 960
 * file. Fall back to the 480 px file once (it always exists) instead of leaving a broken image.
 */
export function fallbackTo480OnError(event: { currentTarget: HTMLImageElement }): void {
  const img = event.currentTarget;
  const small = img.currentSrc.replace(/\/\d+\.webp$/, '/480.webp');
  if (img.getAttribute('src') === small && !img.hasAttribute('srcset')) return;
  img.removeAttribute('srcset');
  img.removeAttribute('sizes');
  img.src = small;
}
