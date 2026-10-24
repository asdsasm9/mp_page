/**
 * Quality facts of one stored photo (WP-10, T-260), read only from the photo row (width, height, variants jsonb).
 * The verdict comes from the shared photoVerdict; "low resolution" is also derived from the master size alone so a photo
 * that lacks a variant AND is small is still counted by the album summary and the filter.
 */
import { DETAIL_MIN_LONG_EDGE, HERO_MIN_MASTER_WIDTH, photoVerdict, type PhotoRow, type PhotoVerdict } from '@mp/shared';

type QualityInput = Pick<PhotoRow, 'width' | 'height' | 'variants'>;

export interface PhotoQuality {
  /** Verdict of the shared contract (missing wins over low). */
  verdict: PhotoVerdict;
  /** Planned variants that are absent, e.g. ['webp720']. */
  missing: string[];
  /** Master long edge is below the detail threshold, whatever else is missing. */
  low: boolean;
  width: number;
  height: number;
  masterBytes: number;
  /** The smallest WebP (the overview tile), in bytes; 0 when there is none. */
  overviewBytes: number;
  /** Existing variants: WebP widths ascending, then 'JPEG' and 'OG', e.g. ['480', '720', 'JPEG', 'OG']. */
  tiers: string[];
}

export function isLowResolution(photo: Pick<PhotoRow, 'width' | 'height'>): boolean {
  return Math.max(photo.width, photo.height) < DETAIL_MIN_LONG_EDGE;
}

/** Too small for the full-width home hero: a low-resolution verdict, or a master narrower than HERO_MIN_MASTER_WIDTH. */
export function isLowForHero(photo: Pick<PhotoRow, 'width' | 'height'>): boolean {
  return isLowResolution(photo) || photo.width < HERO_MIN_MASTER_WIDTH;
}

export function photoQuality(photo: QualityInput): PhotoQuality {
  const { verdict, missing } = photoVerdict(photo.variants, photo.width, photo.height);
  const webp = photo.variants.webp;
  const smallest = webp.length > 0 ? webp.reduce((a, b) => (b.tier < a.tier ? b : a)) : undefined;
  return {
    verdict,
    missing,
    low: isLowResolution(photo),
    width: photo.width,
    height: photo.height,
    masterBytes: photo.variants.master.bytes,
    overviewBytes: smallest?.bytes ?? 0,
    tiers: [
      ...webp.map((e) => String(e.tier)),
      ...(photo.variants.jpeg ? ['JPEG'] : []),
      ...(photo.variants.og ? ['OG'] : []),
    ],
  };
}

/** The badges to show for a photo, in order: low resolution and/or missing variant, otherwise good. */
export function badgeVerdicts(quality: Pick<PhotoQuality, 'low' | 'verdict'>): PhotoVerdict[] {
  const list: PhotoVerdict[] = [];
  if (quality.low) list.push('low');
  if (quality.verdict === 'missing') list.push('missing');
  return list.length > 0 ? list : ['good'];
}

export interface QualitySummary {
  total: number;
  low: number;
}

export function summarizeQuality(photos: readonly Pick<PhotoRow, 'width' | 'height'>[]): QualitySummary {
  return { total: photos.length, low: photos.filter(isLowResolution).length };
}
