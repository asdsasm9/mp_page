// Cover and order phase of the live migration (plan WP-06 3.4, step 11).
// After the photos of an album exist: set the cover to the photo with legacy_key <cat>/<id>/<mainImgNum>.jpg, unless the
// album already has a cover (a different one is drift: reported, never overwritten). Order check: the photos of the album
// sorted by `sort` must be exactly the file numbers 1..n. Albums with missing photos get no cover and no verdict.
import { LEGACY_ALBUMS, legacyKey } from '../../packages/shared/src/legacy/albums';
import { BackendError, type MigrationBackend } from './backend';
import type { MigrateOptions } from './types';

export interface AlbumCover {
  id: string;
  /** Expected cover file number (mainImgNum). */
  number: number;
  /** Photo id of the expected cover, null when that photo does not exist yet. */
  coverId: string | null;
  status: 'set' | 'already' | 'drift' | 'incomplete' | 'failed';
  /** Cover id found on a drifting album. */
  foundCoverId: string | null;
  found: number;
  expected: number;
  /** Sorted by `sort`, the photos are file numbers 1..n and sort values strictly increase. Null when incomplete. */
  orderOk: boolean | null;
}

export interface CoverReport {
  albums: AlbumCover[];
}

const fileNumber = (key: string): number => Number(key.slice(key.lastIndexOf('/') + 1, -'.jpg'.length));

export async function syncCovers(backend: MigrationBackend, options: Pick<MigrateOptions, 'album'>): Promise<CoverReport> {
  const photos = await backend.listPhotosByLegacyKey();
  const stored = new Map((await backend.listAlbums()).map((a) => [a.legacy_id, a] as const));
  const out: AlbumCover[] = [];
  for (const a of LEGACY_ALBUMS.filter((x) => options.album === null || x.id === options.album)) {
    const row = stored.get(a.id);
    const prefix = `${a.legacyCategory}/${a.id}/`;
    const mine = photos.filter((p) => row !== undefined && p.album_id === row.id && p.legacy_key !== null && p.legacy_key.startsWith(prefix));
    const entry: AlbumCover = { id: a.id, number: a.mainImgNum, coverId: null, status: 'incomplete', foundCoverId: null, found: mine.length, expected: a.photoCount, orderOk: null };
    out.push(entry);
    if (row === undefined || mine.length !== a.photoCount) continue;

    const ordered = [...mine].sort((x, y) => x.sort - y.sort);
    entry.orderOk = ordered.every((p, i) => fileNumber(p.legacy_key!) === i + 1 && (i === 0 || ordered[i - 1]!.sort < p.sort));
    const cover = mine.find((p) => p.legacy_key === legacyKey(a.legacyCategory, a.id, a.mainImgNum));
    if (cover === undefined) {
      entry.status = 'failed';
      continue;
    }
    entry.coverId = cover.id;
    if (row.cover_photo_id === null) {
      try {
        await backend.setCover(row.id, cover.id);
        entry.status = 'set';
      } catch (e) {
        if (!(e instanceof BackendError)) throw e;
        entry.status = 'failed';
      }
    } else if (row.cover_photo_id === cover.id) {
      entry.status = 'already';
    } else {
      entry.status = 'drift';
      entry.foundCoverId = row.cover_photo_id;
    }
  }
  return { albums: out };
}

/** No failure and no wrong order. Drift and incomplete albums (already INCOMPLETE through the upload report) do not count here. */
export const coversComplete = (r: CoverReport): boolean => r.albums.every((a) => a.status !== 'failed' && a.orderOk !== false);

export function formatCovers(r: CoverReport): string[] {
  const lines: string[] = [];
  for (const a of r.albums) {
    const order = a.orderOk === null ? 'n/a' : a.orderOk ? 'OK' : 'WRONG';
    lines.push(`${a.id.padEnd(13)} cover ${a.number} ${a.coverId ?? '-'} ${a.status}, order ${order}`);
    if (a.status === 'drift') lines.push(`  DRIFT cover ${a.id}: expected ${a.coverId}, found ${a.foundCoverId} (left unchanged)`);
    if (a.status === 'incomplete') lines.push(`  cover skipped: ${a.found} of ${a.expected} photos present`);
  }
  const set = r.albums.filter((a) => a.status === 'set').length;
  const already = r.albums.filter((a) => a.status === 'already').length;
  const drift = r.albums.filter((a) => a.status === 'drift').length;
  lines.push(`covers set ${set}, already ${already}, drift ${drift}, orders wrong ${r.albums.filter((a) => a.orderOk === false).length}`);
  return lines;
}
