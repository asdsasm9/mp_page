/**
 * Data for the album pages, pure so it can be tested without a build: the thumbnail list (alt from
 * effectiveAlt, loading priority by position) and the Czech date. Plan WP-3 sections 4.2 to 4.6.
 */
import { effectiveAlt, type SnapshotAlbum, type SnapshotCategory, type SnapshotPhoto } from '@mp/shared';

/**
 * Only the first photo is eager (the LCP candidate). Lazy photos that sit inside the first viewport still load
 * at once, so a phone may fetch two or three; the budget gate counts only eager images. T-115 checks real
 * LCP and CLS on an album page.
 */
export const ALBUM_EAGER = 1;

export interface AlbumThumb {
  photo: SnapshotPhoto;
  alt: string;
  eager: boolean;
  priority: boolean;
}

/** Every photo of the album in sort order; only the first (ALBUM_EAGER) is eager, and it has high priority. */
export function albumThumbs(category: Pick<SnapshotCategory, 'slug'>, album: Pick<SnapshotAlbum, 'title' | 'photos'>): AlbumThumb[] {
  const total = album.photos.length;
  return album.photos.map((photo, i) => ({
    photo,
    alt: effectiveAlt(photo, { albumTitle: album.title, categoryKey: category.slug, n: i + 1, total }),
    eager: i < ALBUM_EAGER,
    priority: i === 0,
  }));
}

// ---------------------------------------------------------------- justified rows (T-216)

/** Albums with fewer photos than this get taller rows, so a short album fills the screen instead of looking empty. */
export const FEW_PHOTOS = 10;

/** Target row heights in rem at the base, 40rem and 64rem layouts. The CSS reads the same numbers (inline custom properties). */
export const ROW_REM = {
  regular: { base: 12, md: 15, lg: 17 },
  few: { base: 14, md: 20, lg: 24 },
} as const;

/**
 * How much wider than its nominal width (aspect x row height) a tile is rendered on average once the row is justified.
 * Only the eager first photo relies on this estimate (lazy ones use sizes="auto"); from 40rem a tile is capped at
 * 2.2 x nominal (CSS --cap in AlbumGrid).
 */
const STRETCH = { base: 2, md: 1.3, lg: 1.3 } as const;

export function rowRemFor(count: number) {
  return count < FEW_PHOTOS ? ROW_REM.few : ROW_REM.regular;
}

/** Aspect ratio (width / height) of a photo, rounded so the inline style stays short. */
export function aspectOf(photo: Pick<SnapshotPhoto, 'width' | 'height'>): number {
  return Math.round((photo.width / photo.height) * 1000) / 1000;
}

/**
 * `sizes` for one tile of the justified grid. A tile is about aspect x row height wide, stretched a little to fill the
 * row; on a phone it never exceeds the page width. The browser then picks a tier that is sharp but not wasteful.
 */
export function gridSizes(aspect: number, count: number, lazy = false): string {
  const rows = rowRemFor(count);
  const rem = (n: number, stretch: number) => `${Math.round(aspect * n * stretch * 10) / 10}rem`;
  // Lazy images wait for layout anyway, so `sizes="auto"` lets the browser use the real tile width; the estimate
  // that follows is the fallback for browsers without it. The eager first photo loads before layout and needs the estimate.
  return [
    ...(lazy ? ['auto'] : []),
    `(min-width: 64rem) min(${rem(rows.lg, STRETCH.lg)}, 75rem)`,
    `(min-width: 40rem) ${rem(rows.md, STRETCH.md)}`,
    `min(${rem(rows.base, STRETCH.base)}, calc(100vw - 2rem))`,
  ].join(', ');
}

/**
 * Photos for a layout-check page: `count` distinct photos taken from `pool`. Short albums alternate landscape and
 * portrait (the worst case for gaps in a grid); long ones keep the pool order.
 */
export function layoutCheckPhotos(pool: readonly SnapshotPhoto[], count: number): SnapshotPhoto[] {
  if (count >= FEW_PHOTOS) return pool.slice(0, count);
  const landscape = pool.filter((p) => p.width >= p.height);
  const portrait = pool.filter((p) => p.width < p.height);
  const out: SnapshotPhoto[] = [];
  for (let i = 0; out.length < count; i++) {
    const next = i % 2 === 0 ? landscape[i >> 1] : portrait[i >> 1];
    if (next) out.push(next);
    else if (i > 2 * pool.length) break;
  }
  return out;
}

/** `2023-06-17` to `17. června 2023`; null for no date. Computed in UTC so the build machine's zone cannot shift it. */
export function formatShotOn(shotOn: string | null): string | null {
  if (!shotOn) return null;
  const date = new Date(`${shotOn}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}
