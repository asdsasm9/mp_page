/**
 * Image helpers (plan WP-3 section 4.5). Pure functions. Keys come only from the shared key helpers,
 * never from string concatenation in components. The srcset is built from the variants that actually
 * exist, never from the plan, and every width and height is the stored one.
 */
import { jpegKey, ogKey, webpKey, type SnapshotPhoto, type WebpTier } from '@mp/shared';

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
  return {
    webp,
    webpSrcset: webp.map((e) => `${e.url} ${e.width}w`).join(', '),
    fallback,
    width: fallback.width,
    height: fallback.height,
    placeholderStyle: photo.dominantColor ? `--c:${photo.dominantColor}` : null,
  };
}

export type SizesContext = 'grid' | 'card' | 'lightbox' | 'hero';

const SIZES: Record<SizesContext, string> = {
  // Album grid: three columns on wide screens, two on medium, one on narrow.
  grid: '(min-width: 64rem) 33vw, (min-width: 40rem) 50vw, 100vw',
  // Category and album card: three columns from 48rem (page gutters make it a little under 33vw).
  card: '(min-width: 48rem) 33vw, 100vw',
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
  fetchpriority?: 'high';
}

/** Lazy by default. `eager` only when requested; `fetchpriority="high"` only for the priority (LCP) image, which is eager too. */
export function loadingAttrs(opts: { eager?: boolean; priority?: boolean } = {}): LoadingAttrs {
  if (opts.priority) return { loading: 'eager', decoding: 'async', fetchpriority: 'high' };
  return { loading: opts.eager ? 'eager' : 'lazy', decoding: 'async' };
}
