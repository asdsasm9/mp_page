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
export function albumThumbs(category: Pick<SnapshotCategory, 'slug'>, album: SnapshotAlbum): AlbumThumb[] {
  const total = album.photos.length;
  return album.photos.map((photo, i) => ({
    photo,
    alt: effectiveAlt(photo, { albumTitle: album.title, categoryKey: category.slug, n: i + 1, total }),
    eager: i < ALBUM_EAGER,
    priority: i === 0,
  }));
}

/** `2023-06-17` to `17. června 2023`; null for no date. Computed in UTC so the build machine's zone cannot shift it. */
export function formatShotOn(shotOn: string | null): string | null {
  if (!shotOn) return null;
  const date = new Date(`${shotOn}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}
