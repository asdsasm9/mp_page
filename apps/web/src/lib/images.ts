/**
 * Image helpers (plan WP-3 section 4.5). Pure functions. Keys come only from the shared key helpers,
 * never from string concatenation in components. The srcset is built from the variants that actually
 * exist, never from the plan, and every width and height is the stored one.
 */
import { jpegKey, masterKey, ogKey, webpKey, type SnapshotPhoto, type WebpTier } from '@mp/shared';

/** Lightbox fit tiers: the large WebP tiers (1600 and 2400), when they exist for a photo. */
const LIGHTBOX_MIN_TIER = 1600;

export interface SourceEntry {
  url: string;
  /** Real pixel width of the stored variant (the srcset `w` descriptor). */
  width: number;
  height: number;
}

export interface PhotoSources {
  /** One entry per WebP tier that exists in `variants.webp`, ascending. */
  webp: SourceEntry[];
  /** `url 480w, url 960w` built from `webp`. */
  webpSrcset: string;
  /** The 1600.jpg fallback, with the stored JPEG dimensions. */
  fallback: SourceEntry;
  /** Intrinsic dimensions for the `<img>` (the fallback variant), so the box ratio is right before load. */
  width: number;
  height: number;
  /** `--c:#rrggbb` placeholder style, or null when the photo has no dominant colour. */
  placeholderStyle: string | null;
  /** The stored master JPEG with its real dimensions. Loaded by the zoom script only, never in the initial markup. */
  master: SourceEntry;
  /**
   * srcset of the 1600 and 2400 WebP tiers that exist (the lightbox fit candidates). If a small master has
   * neither, the largest existing tier is used so the lightbox always has a source.
   */
  lightboxSet: string;
}

const trimBase = (base: string): string => base.replace(/\/+$/, '');

export function photoSources(photo: SnapshotPhoto, base: string): PhotoSources {
  const b = trimBase(base);
  const webp = photo.variants.webp.map((v) => ({
    url: `${b}/${webpKey(photo.id, v.tier as WebpTier)}`,
    width: v.w,
    height: v.h,
  }));
  const jpeg = photo.variants.jpeg;
  const fallback = { url: `${b}/${jpegKey(photo.id)}`, width: jpeg.w, height: jpeg.h };
  const srcset = (list: SourceEntry[]): string => list.map((e) => `${e.url} ${e.width}w`).join(', ');
  const large = webp.filter((_, i) => (photo.variants.webp[i]?.tier ?? 0) >= LIGHTBOX_MIN_TIER);
  const lightbox = large.length > 0 ? large : webp.slice(-1);
  return {
    webp,
    webpSrcset: srcset(webp),
    fallback,
    width: fallback.width,
    height: fallback.height,
    placeholderStyle: photo.dominantColor ? `--c:${photo.dominantColor}` : null,
    master: { url: `${b}/${masterKey(photo.id)}`, width: photo.variants.master.w, height: photo.variants.master.h },
    lightboxSet: srcset(lightbox),
  };
}

export type SizesContext = 'grid' | 'card' | 'lightbox' | 'hero';

const SIZES: Record<SizesContext, string> = {
  // Album grid: three columns from 64rem, two from 40rem, one below; page gutter is 1rem minimum per side.
  // 24.5rem cap = (--layout-max 80rem - 2 x 2.5rem gutter - 2 x --space-3 gap) / 3, the real column maximum.
  grid: '(min-width: 64rem) min(33vw, 24.5rem), (min-width: 40rem) 50vw, calc(100vw - 3rem)',
  // Category and album card: three columns from 48rem. The real maximum is 24rem (gap --space-5);
  // 24.5rem is the shared, marginally conservative cap.
  // Below the cap the column is (100vw - 7rem) / 3: measured 219.5 px at 768 px (33vw said 253 and made the
  // browser take 720 instead of 480 at DPR 2).
  // 33rem = the real three-column track at the 110rem layout width (519 px at 1920); the phone gutter is 1.5rem a side (T-274).
  card: '(min-width: 48rem) min((100vw - 7rem) / 3, 33rem), calc(100vw - 3rem)',
  // Lightbox and full-width hero use the whole viewport.
  lightbox: '100vw',
  hero: '100vw',
};

export function sizesFor(context: SizesContext): string {
  return SIZES[context];
}

/**
 * Cropped covers (WP-12 F10). A card cover is `object-fit: cover` in a fixed box (category 3/4, album 4/5), so a
 * 3:2 landscape photo must be about twice the box width to fill the box height sharply. The box-width `sizes`
 * strings above would deliver half the sharpness, so every length is multiplied by the crop factor.
 */
export type CropContext = 'category' | 'album';

/** Box-width `sizes` of the card grids (auto-fill tracks: 15rem and 18.75rem minimum, 3.5rem column gap (--grid-col-gap, T-321), 1.5rem gutter on phones). */
const CROP_BASE: Record<CropContext, string> = {
  // Tracks measured with image-fit (before T-321, gap 32 px, 21rem at 48rem; now 56 px gap and 20rem: 320 px at 768): 337 px at 768, 293 at 1024, 270 at 1280, 241 at 1920 (so the steps at 80rem and 100rem)
  category: '(min-width: 100rem) 16rem, (min-width: 80rem) 18rem, (min-width: 48rem) 20rem, calc(100vw - 3rem)',
  album: '(min-width: 48rem) 26rem, calc(100vw - 3rem)',
};

/** Box height over box width of the cover boxes (`--ratio-category` 3 / 4, `--ratio-album` 4 / 5). */
const CROP_BOX_H_OVER_W: Record<CropContext, number> = { category: 4 / 3, album: 5 / 4 };

/** Splits a `sizes` list at top-level commas (commas inside `min(...)` and `calc(...)` do not count). */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts.filter((p) => p.length > 0);
}

/** Crop factor: how many times wider than the box the source must be so the cover fills the box height. */
export function cropFactor(photoAspect: number, boxHeightOverWidth: number): number {
  if (!Number.isFinite(photoAspect) || photoAspect <= 0) return 1;
  return Math.max(1, Math.round(photoAspect * boxHeightOverWidth * 100) / 100);
}

/**
 * Multiplies every length of a `sizes` string by the crop factor `k = max(1, photoAspect x boxH/boxW)`, written as
 * `calc(<length> * k)`. Media conditions are left alone. `photoAspect` is width over height; `boxHeightOverWidth` is
 * the box height over its width (4 / 3 for a 3 / 4 box). With k = 1 the string is returned unchanged.
 */
export function coverSizes(base: string, photoAspect: number, boxHeightOverWidth: number): string {
  const k = cropFactor(photoAspect, boxHeightOverWidth);
  if (k === 1) return base;
  return splitTopLevel(base)
    .map((entry) => {
      let media = '';
      let length = entry;
      if (entry.startsWith('(')) {
        let depth = 0;
        let end = 0;
        for (let i = 0; i < entry.length; i++) {
          if (entry[i] === '(') depth++;
          else if (entry[i] === ')' && --depth === 0) {
            end = i + 1;
            break;
          }
        }
        // A bare parenthesised length such as `(100vw - 2rem) / 3` has no media condition; a media condition is
        // followed by a length that does not start with an operator.
        const rest = entry.slice(end).trim();
        if (rest.length > 0 && !/^[/*+-]/.test(rest)) {
          media = `${entry.slice(0, end)} `;
          length = rest;
        }
      }
      const inner = /^calc\((.*)\)$/s.exec(length);
      return `${media}calc(${inner ? `(${inner[1]})` : length} * ${k})`;
    })
    .join(', ');
}

/**
 * `sizes` for a cover that is cropped into the category or album box. The LCP card (`lcp`) gets the plain box-width
 * string (WP-12 decision 13: the sharper crop-aware request is not allowed to cost LCP time on the first image).
 */
export function cropSizes(crop: CropContext, photoWidth: number, photoHeight: number, lcp = false): string {
  if (lcp) return CROP_BASE[crop];
  return coverSizes(CROP_BASE[crop], photoWidth / photoHeight, CROP_BOX_H_OVER_W[crop]);
}

export interface OgImage {
  url: string;
  width: number;
  height: number;
  type: 'image/jpeg';
}

/** Open Graph image of a photo: its `og.jpg` with the stored dimensions. */
export function ogImage(photo: SnapshotPhoto, base: string): OgImage {
  return {
    url: `${trimBase(base)}/${ogKey(photo.id)}`,
    width: photo.variants.og.w,
    height: photo.variants.og.h,
    type: 'image/jpeg',
  };
}

export interface LoadingAttrs {
  loading: 'lazy' | 'eager';
  decoding: 'async';
  fetchpriority?: 'high' | 'low';
}

/** Lazy by default. `eager` only when requested; `fetchpriority="high"` only for the priority (LCP) image, which is eager too. */
export function loadingAttrs(opts: { eager?: boolean; priority?: boolean } = {}): LoadingAttrs {
  if (opts.priority) return { loading: 'eager', decoding: 'async', fetchpriority: 'high' };
  if (opts.eager) return { loading: 'eager', decoding: 'async', fetchpriority: 'low' };
  return { loading: 'lazy', decoding: 'async' };
}
