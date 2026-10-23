/**
 * Replace a photo with a better file, option A of WP-10 section 5 (D-21): a client-side swap with no Worker, SQL
 * or migration change. The new file is uploaded as a NEW photo (a new id and new image URLs: files are immutable
 * cached under the id) and then, step by step:
 *
 *   1. add     the new photo goes into the same album (the normal upload queue, done by the caller)
 *   2. copy    sort, alt and caption of the old photo are written to the new one (updatePhoto)
 *   3. cover   when the old photo is the album cover, the new photo becomes the cover (updateAlbum); the same for
 *              the main photo of the category (updateCategory)
 *   4. delete  the old photo is deleted through the Worker (only after both photos are verified in the same album)
 *
 * Any failure after step 1 leaves both photos in place: the old photo is deleted only as the very last step and
 * never when an earlier step failed. `finish` can be called again from the step that failed.
 */
import type { AlbumRow, PhotoRow } from '@mp/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/session';
import { ApiError, NetworkError } from '../ports';
import { usePorts } from '../ports-context';
import { catalogKeys } from './catalog';
import { expectUpdatedAt } from './concurrency';
import { usePhotoDeleter } from './deleteActions';
import { isOnline } from './health';

/** The steps after the add, in order. */
export const REPLACE_STEPS = ['copy', 'cover', 'delete'] as const;
export type ReplaceStep = (typeof REPLACE_STEPS)[number];

/** A step failed; `cause` is the underlying error (shown with the usual Czech message). */
export class ReplaceStepError extends Error {
  constructor(
    readonly step: ReplaceStep,
    readonly cause: unknown,
  ) {
    super(`REPLACE_${step.toUpperCase()}`);
    this.name = 'ReplaceStepError';
  }
}

export interface ReplaceTarget {
  albumId: string;
  /** The photo being replaced. */
  oldId: string;
  /** The newly added photo. */
  newId: string;
}

export function usePhotoReplace() {
  const { catalog } = usePorts();
  const { runAuthed } = useSession();
  const queryClient = useQueryClient();
  const { deleteRows } = usePhotoDeleter();

  const listFresh = (albumId: string) =>
    queryClient.fetchQuery({
      queryKey: catalogKeys.photos(albumId),
      queryFn: () => runAuthed(() => catalog.listPhotos(albumId)),
      staleTime: 0,
    });
  const requireOnline = () => {
    if (!isOnline()) throw new NetworkError();
  };

  async function pair(target: ReplaceTarget): Promise<{ old: PhotoRow; added: PhotoRow }> {
    const photos = await listFresh(target.albumId);
    const old = photos.find((p) => p.id === target.oldId);
    const added = photos.find((p) => p.id === target.newId);
    // Both photos must be in this album, or nothing here may continue (and nothing is deleted).
    if (!old || !added) throw new ApiError('NOT_FOUND');
    return { old, added };
  }

  async function copyFields(target: ReplaceTarget): Promise<void> {
    requireOnline();
    const { old, added } = await pair(target);
    await runAuthed(() =>
      catalog.updatePhoto(added.id, { sort: old.sort, alt: old.alt, caption: old.caption }, expectUpdatedAt(added)),
    );
  }

  async function moveCover(target: ReplaceTarget): Promise<void> {
    requireOnline();
    const album = await runAuthed(() => catalog.getAlbum(target.albumId));
    if (!album) throw new ApiError('NOT_FOUND');
    if (album.cover_photo_id === target.oldId) {
      await runAuthed(() => catalog.updateAlbum(album.id, { cover_photo_id: target.newId }, expectUpdatedAt(album)));
    }
    // The category cover moves the same way. It must happen before the old photo is deleted: deleting a category's
    // main photo clears the choice (trigger clear_category_cover_on_photo_change), and the new photo is in the same
    // album, so the database check accepts it.
    const category = await runAuthed(() => catalog.getCategory(album.category_id));
    if (category && category.cover_photo_id === target.oldId) {
      await runAuthed(() =>
        catalog.updateCategory(category.id, { cover_photo_id: target.newId }, expectUpdatedAt(category)),
      );
    }
  }

  async function removeOld(target: ReplaceTarget): Promise<void> {
    requireOnline();
    const { old, added } = await pair(target);
    if (old.album_id !== added.album_id) throw new ApiError('CONFLICT');
    const album: AlbumRow | null = await runAuthed(() => catalog.getAlbum(target.albumId));
    // The cover must already be off the old photo, or the album would be left without its cover.
    if (!album || album.cover_photo_id === target.oldId) throw new ApiError('CONFLICT');
    // Same for the category cover: it must already be off the old photo, or the delete would silently clear it.
    const category = await runAuthed(() => catalog.getCategory(album.category_id));
    if (category && category.cover_photo_id === target.oldId) throw new ApiError('CONFLICT');
    const result = await deleteRows([old]);
    if (result.error !== null) throw result.error;
    if (result.failedIds.length > 0) throw new ApiError('INTERNAL');
  }

  const runners: Record<ReplaceStep, (target: ReplaceTarget) => Promise<void>> = {
    copy: copyFields,
    cover: moveCover,
    delete: removeOld,
  };

  /** Runs the steps from `from` on. Throws ReplaceStepError for the step that failed; the caches are refreshed either way. */
  async function finish(target: ReplaceTarget, from: ReplaceStep = 'copy', onStep?: (step: ReplaceStep) => void): Promise<void> {
    try {
      for (const step of REPLACE_STEPS.slice(REPLACE_STEPS.indexOf(from))) {
        onStep?.(step);
        try {
          await runners[step](target);
        } catch (error) {
          throw new ReplaceStepError(step, error);
        }
      }
    } finally {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.all });
    }
  }

  return { finish };
}
