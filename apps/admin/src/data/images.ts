/** URLs of photo files on the public image host. Keys come from the shared helpers (derived from the photo id only). */
import { isValidPhotoId, webpKey, type WebpTier } from '@mp/shared';

/** The WebP of a photo at the given width tier, or null for an id that is not a valid photo id. */
export function photoWebpUrl(imgBase: string, photoId: string, tier: WebpTier = 480): string | null {
  return isValidPhotoId(photoId) ? `${imgBase}/${webpKey(photoId, tier)}` : null;
}
