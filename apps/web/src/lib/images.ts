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
  grid: '(min-width: 64rem) min(33vw, 24.5rem), (min-width: 40rem) 50vw, calc(100vw - 2rem)',
  // Category and album card: three columns from 48rem. The real maximum is 24rem (gap --space-5);
  // 24.5rem is the shared, marginally conservative cap.
  card: '(min-width: 48rem) min(33vw, 24.5rem), calc(100vw - 2rem)',
  // Lightbox and full-width hero use the whole viewport.
  lightbox: '100vw',
  hero: '100vw',
};

export function sizesFor(context: SizesContext): string {
  return SIZES[context];
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
