/**
 * Album-level actions shared by the category detail rows and the album screen: publish, hide, move to
 * another category. An album without photos is refused before any write (ADMIN-UX F3).
 */
import type { AlbumRow } from '@mp/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/session';
import { cs } from '../i18n/cs';
import { errorMessage } from '../i18n/messages';
import { usePorts } from '../ports-context';
import { catalogKeys, useUpdateAlbum } from './catalog';
import { expectUpdatedAt } from './concurrency';
import { nextSortAfterLast } from './order';

/** Thrown by publish() for an album that has no photos; nothing was written. */
export class EmptyAlbumError extends Error {
  constructor() {
    super('EMPTY_ALBUM');
    this.name = 'EmptyAlbumError';
  }
}

/** The Czech text for a failed album action. */
export function albumActionMessage(error: unknown): string {
  return error instanceof EmptyAlbumError ? cs.albums.emptyCannotPublish : errorMessage(error);
}

export function useAlbumActions() {
  const update = useUpdateAlbum();
  const queryClient = useQueryClient();
  const { catalog } = usePorts();
  const { runAuthed } = useSession();

  /** Sets published=true. The photo count is read fresh, so a stale list cannot let an empty album through. */
  async function publish(album: AlbumRow): Promise<AlbumRow> {
    const photos = await queryClient.fetchQuery({
      queryKey: catalogKeys.photos(album.id),
      queryFn: () => runAuthed(() => catalog.listPhotos(album.id)),
      staleTime: 0,
    });
    if (photos.length === 0) throw new EmptyAlbumError();
    const row = await update.mutateAsync({ id: album.id, patch: { published: true }, options: expectUpdatedAt(album) });
    return row;
  }

  async function hide(album: AlbumRow): Promise<AlbumRow> {
    const row = await update.mutateAsync({ id: album.id, patch: { published: false }, options: expectUpdatedAt(album) });
    return row;
  }

  /** Moves the album to the end of another category (its address stays unique across categories). */
  async function move(album: AlbumRow, categoryId: string, targetAlbums: readonly AlbumRow[]): Promise<AlbumRow> {
    return update.mutateAsync({
      id: album.id,
      patch: { category_id: categoryId, sort: nextSortAfterLast(targetAlbums.filter((a) => a.category_id === categoryId)) },
      options: expectUpdatedAt(album),
    });
  }

  return { publish, hide, move };
}
