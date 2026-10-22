/**
 * Album status for the badge. The database has only `albums.published`, so the admin shows exactly two
 * states: "Zveřejněno" (published) and "Nezveřejněno" (unpublished, which covers both a new draft and an
 * album that was hidden after being public).
 *
 * Deviation from ADMIN-UX 3.3 / F4, which name "Koncept" and "Skryto" separately: telling them apart needs
 * a status column (a migration, out of scope for the admin app). Per-browser memory was rejected as
 * unreliable. When such a column exists, add the third state here.
 */
import type { AlbumRow } from '@mp/shared';

export type AlbumStatus = 'published' | 'unpublished';

export function albumStatus(album: Pick<AlbumRow, 'published'>): AlbumStatus {
  return album.published ? 'published' : 'unpublished';
}
