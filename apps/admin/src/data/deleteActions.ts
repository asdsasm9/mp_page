/**
 * Delete flows (WP5-15, ADMIN-UX F5). Photos go through the Worker (POST /photos/delete, at most 200 ids per
 * request, via useDeletePhotos so the storage bar and the publish dot refresh); the catalog adapter never deletes
 * a photo. An album is deleted photos first (chunks), then its row; any failure keeps the row.
 */
import type { AlbumRow, PhotoRow } from '@mp/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/session';
import { usePorts } from '../ports-context';
import { catalogKeys, useDeleteAlbum } from './catalog';
import { useDeletePhotos } from './storage';
import { usePhotoActions } from './photoActions';

/** docs/API.md: 1 to 200 ids per request. */
export const DELETE_CHUNK = 200;

export function chunkIds<T>(items: readonly T[], size: number = DELETE_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type DeletableRow = Pick<PhotoRow, 'id' | 'bytes_total'>;

export interface PhotoDeleteResult {
  /** Rows gone and their objects deleted. */
  removedIds: string[];
  /**
   * Ids that need attention: the Worker's `failed` list (row gone, objects left for reconcile) plus the ids of a
   * chunk whose request threw and every chunk after it (rows may still exist).
   */
  failedIds: string[];
  /** Sum of bytes_total of the removed rows. */
  freedBytes: number;
  /** The error that stopped the loop, if a request threw. */
  error: unknown;
}

export interface DeleteOutcome extends PhotoDeleteResult {
  /** The cover was among the removed photos and now is the first remaining photo. */
  coverReassigned: boolean;
}

export function usePhotoDeleter() {
  const del = useDeletePhotos();
  const { ensureCover } = usePhotoActions();

  /** Sequential chunks of 200. Stops at the first request that throws. */
  async function deleteRows(rows: readonly DeletableRow[]): Promise<PhotoDeleteResult> {
    const bytes = new Map(rows.map((r) => [r.id, r.bytes_total] as const));
    const result: PhotoDeleteResult = { removedIds: [], failedIds: [], freedBytes: 0, error: null };
    const chunks = chunkIds([...bytes.keys()]);
    for (let i = 0; i < chunks.length; i += 1) {
      const ids = chunks[i]!;
      try {
        const response = await del.mutateAsync({ ids });
        const failed = new Set(response.failed);
        for (const id of ids) {
          if (failed.has(id)) {
            result.failedIds.push(id);
          } else {
            result.removedIds.push(id);
            result.freedBytes += bytes.get(id) ?? 0;
          }
        }
      } catch (error) {
        result.error = error;
        result.failedIds.push(...chunks.slice(i).flat());
        break;
      }
    }
    return result;
  }

  /** Deletes photos of one album; a deleted cover is replaced by the first remaining photo. */
  async function deletePhotos(album: AlbumRow, rows: readonly DeletableRow[]): Promise<DeleteOutcome> {
    const result = await deleteRows(rows);
    let coverReassigned = false;
    const coverGone = album.cover_photo_id !== null && result.removedIds.includes(album.cover_photo_id);
    if (coverGone) {
      try {
        coverReassigned = (await ensureCover(album.id)) !== null;
      } catch {
        coverReassigned = false;
      }
    }
    return { ...result, coverReassigned };
  }

  return { deleteRows, deletePhotos };
}

export interface AlbumDeleteResult extends PhotoDeleteResult {
  albumDeleted: boolean;
}

export function useAlbumDeleter() {
  const { deleteRows } = usePhotoDeleter();
  const removeRow = useDeleteAlbum();
  const { catalog } = usePorts();
  const { runAuthed } = useSession();
  const queryClient = useQueryClient();

  /**
   * Photos first, then the album row. Anything in `failedIds` or a thrown request keeps the album. `retryIds` are
   * the failed ids of an earlier attempt (their rows may be gone, so they are sent again).
   */
  async function deleteAlbum(album: AlbumRow, retryIds: readonly string[] = []): Promise<AlbumDeleteResult> {
    const photos = await queryClient.fetchQuery({
      queryKey: catalogKeys.photos(album.id),
      queryFn: () => runAuthed(() => catalog.listPhotos(album.id)),
      staleTime: 0,
    });
    const known = new Set(photos.map((p) => p.id));
    const rows: DeletableRow[] = [
      ...photos,
      ...retryIds.filter((id) => !known.has(id)).map((id) => ({ id, bytes_total: 0 })),
    ];
    const result = await deleteRows(rows);
    if (result.failedIds.length > 0 || result.error !== null) return { ...result, albumDeleted: false };
    await removeRow.mutateAsync(album.id);
    return { ...result, albumDeleted: true };
  }

  return { deleteAlbum };
}
