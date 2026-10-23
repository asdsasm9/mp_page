/**
 * Photo-level writes of the album screen (WP5-14). Photos are only ever PATCHed (album_id, sort, alt, caption)
 * through the CatalogPort; nothing here inserts or deletes a photo. Pure helpers (cover pick, move plan) are
 * exported for tests.
 */
import type { AlbumRow, PhotoRow } from '@mp/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/session';
import { NetworkError } from '../ports';
import { usePorts } from '../ports-context';
import { catalogKeys } from './catalog';
import { markCategoryCoverCleared } from './categoryCoverNotice';
import { expectUpdatedAt } from './concurrency';
import { isOnline } from './health';
import { SORT_STEP, nextSortAfterLast, sortedRows, type SortUpdate } from './order';

/**
 * Auto-cover helper: the first photo (by order) when the album has no cover, or its cover is not among the
 * photos; otherwise null (a cover the photographer chose is never replaced). Used after uploads and moves.
 */
export function pickAutoCover(album: Pick<AlbumRow, 'cover_photo_id'>, photos: readonly PhotoRow[]): string | null {
  if (photos.length === 0) return null;
  if (album.cover_photo_id !== null && photos.some((p) => p.id === album.cover_photo_id)) return null;
  return sortedRows(photos)[0]!.id;
}

/** `{ album_id, sort }` for each moved photo: appended after the target's last photo, keeping the given order. */
export function planAppend(targetPhotos: readonly PhotoRow[], movingIds: readonly string[]): Array<{ id: string; sort: number }> {
  const base = nextSortAfterLast(targetPhotos);
  return movingIds.map((id, i) => ({ id, sort: base + i * SORT_STEP }));
}

export interface MoveResult {
  moved: number;
  /** The source album's cover was among the moved photos and now is its first remaining photo. */
  coverReassigned: boolean;
}

export function usePhotoActions() {
  const { catalog } = usePorts();
  const { runAuthed } = useSession();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: catalogKeys.all });
  const requireOnline = () => {
    if (!isOnline()) throw new NetworkError();
  };
  const listFresh = (albumId: string) =>
    queryClient.fetchQuery({
      queryKey: catalogKeys.photos(albumId),
      queryFn: () => runAuthed(() => catalog.listPhotos(albumId)),
      staleTime: 0,
    });

  /** Sets the album cover (PATCH on the album row). */
  async function setCover(album: AlbumRow, photoId: string): Promise<void> {
    requireOnline();
    try {
      await runAuthed(() => catalog.updateAlbum(album.id, { cover_photo_id: photoId }, expectUpdatedAt(album)));
    } finally {
      await refresh();
    }
  }

  /** Gives an album without a cover its first photo as cover. Returns the new cover id, or null if nothing changed. */
  async function ensureCover(albumId: string): Promise<string | null> {
    requireOnline();
    const [album, photos] = await Promise.all([runAuthed(() => catalog.getAlbum(albumId)), listFresh(albumId)]);
    if (!album) return null;
    const pick = pickAutoCover(album, photos);
    if (pick === null) return null;
    await runAuthed(() => catalog.updateAlbum(albumId, { cover_photo_id: pick }, expectUpdatedAt(album)));
    await refresh();
    return pick;
  }

  /** Writes new `sort` numbers (only `sort` is sent), one PATCH per changed photo. */
  async function reorder(updates: readonly SortUpdate[], rows: readonly PhotoRow[]): Promise<void> {
    requireOnline();
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    try {
      for (const u of updates) {
        const row = byId.get(u.id);
        await runAuthed(() => catalog.updatePhoto(u.id, { sort: u.sort }, row ? expectUpdatedAt(row) : undefined));
      }
    } finally {
      await refresh();
    }
  }

  /**
   * True when the main photo of the source category is among the moved photos and the target album belongs to another
   * category (the database then clears the choice; inside one category it stays). Only feeds a notice, so a read that
   * fails answers false.
   */
  async function leavesCategoryCover(source: AlbumRow, targetAlbumId: string, movingIds: readonly string[]): Promise<boolean> {
    try {
      const [category, target] = await Promise.all([
        runAuthed(() => catalog.getCategory(source.category_id)),
        runAuthed(() => catalog.getAlbum(targetAlbumId)),
      ]);
      const cover = category?.cover_photo_id ?? null;
      return cover !== null && movingIds.includes(cover) && target !== null && target.category_id !== source.category_id;
    } catch {
      return false;
    }
  }

  /**
   * Moves photos to the end of another album (album_id + sort only; storage keys are untouched). `movingIds`
   * must be in the order they had in the source album. If the source cover moves away, the first remaining
   * photo becomes the cover.
   */
  async function movePhotos(source: AlbumRow, targetAlbumId: string, movingIds: readonly string[]): Promise<MoveResult> {
    requireOnline();
    if (movingIds.length === 0 || targetAlbumId === source.id) return { moved: 0, coverReassigned: false };
    try {
      const [sourcePhotos, targetPhotos] = await Promise.all([listFresh(source.id), listFresh(targetAlbumId)]);
      const rows = new Map(sourcePhotos.map((p) => [p.id, p] as const));
      const losesCategoryCover = await leavesCategoryCover(source, targetAlbumId, movingIds);
      let moved = 0;
      for (const step of planAppend(targetPhotos, movingIds)) {
        const row = rows.get(step.id);
        if (!row) continue;
        await runAuthed(() =>
          catalog.updatePhoto(step.id, { album_id: targetAlbumId, sort: step.sort }, expectUpdatedAt(row)),
        );
        moved += 1;
      }
      if (losesCategoryCover && moved > 0) markCategoryCoverCleared(source.category_id);
      const wasCover = source.cover_photo_id !== null && movingIds.includes(source.cover_photo_id);
      let coverReassigned = false;
      if (wasCover) {
        const rest = sortedRows(sourcePhotos.filter((p) => !movingIds.includes(p.id)));
        const fresh = await runAuthed(() => catalog.getAlbum(source.id));
        if (fresh && rest[0]) {
          await runAuthed(() => catalog.updateAlbum(source.id, { cover_photo_id: rest[0]!.id }, expectUpdatedAt(fresh)));
          coverReassigned = true;
        }
      }
      // A target album without a cover gets its first photo as cover; an existing cover is never replaced.
      if (moved > 0) {
        const [target, targetAfter] = await Promise.all([runAuthed(() => catalog.getAlbum(targetAlbumId)), listFresh(targetAlbumId)]);
        const pick = target ? pickAutoCover(target, targetAfter) : null;
        if (target && pick) {
          await runAuthed(() => catalog.updateAlbum(targetAlbumId, { cover_photo_id: pick }, expectUpdatedAt(target)));
        }
      }
      return { moved, coverReassigned };
    } finally {
      await refresh();
    }
  }

  return { setCover, ensureCover, reorder, movePhotos };
}
