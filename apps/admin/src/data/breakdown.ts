/** Per-album storage breakdown (ADMIN-UX 3.7): sums photos.bytes_total per album, biggest first. */
import { totalBytes, type AlbumRow, type PhotoRow } from '@mp/shared';

export interface BreakdownRow {
  id: string;
  title: string;
  photos: number;
  bytes: number;
}

export interface Breakdown {
  rows: BreakdownRow[];
  totalBytes: number;
  totalPhotos: number;
  /** Some album's photos are still loading or failed: the rows are not the whole picture yet. */
  complete: boolean;
}

export function buildBreakdown(
  albums: readonly AlbumRow[],
  photosByAlbum: ReadonlyMap<string, PhotoRow[] | undefined>,
): Breakdown {
  const rows: BreakdownRow[] = [];
  let complete = true;
  for (const album of albums) {
    const photos = photosByAlbum.get(album.id);
    if (!photos) {
      complete = false;
      continue;
    }
    if (photos.length === 0) continue;
    rows.push({
      id: album.id,
      title: album.title,
      photos: photos.length,
      bytes: totalBytes(photos),
    });
  }
  rows.sort((a, b) => b.bytes - a.bytes || a.title.localeCompare(b.title, 'cs') || (a.id < b.id ? -1 : 1));
  return {
    rows,
    totalBytes: rows.reduce((n, r) => n + r.bytes, 0),
    totalPhotos: rows.reduce((n, r) => n + r.photos, 0),
    complete,
  };
}

/** photo id -> where it lives ("Fotka 3 v albu X"), for the reconcile report rows. */
export function photoLocations(
  albums: readonly AlbumRow[],
  photosByAlbum: ReadonlyMap<string, PhotoRow[] | undefined>,
): Map<string, { n: number; album: string }> {
  const out = new Map<string, { n: number; album: string }>();
  for (const album of albums) {
    (photosByAlbum.get(album.id) ?? []).forEach((p, i) => out.set(p.id, { n: i + 1, album: album.title }));
  }
  return out;
}
