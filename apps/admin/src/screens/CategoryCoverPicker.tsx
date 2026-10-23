/**
 * Picker of the main photo of a category (WP-11, T-272): step 1 the album (radio list), step 2 a photo of it (radio
 * grid, native radios so the arrow keys move the choice). A low-resolution photo can be chosen but shows a warning.
 * Saving PATCHes categories.cover_photo_id with the updated_at the screen was based on. When the database says the
 * photo is no longer in the category the lists are refreshed and the Czech sentence is shown.
 */
import type { AlbumRow, CategoryRow } from '@mp/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { DialogActions, DialogButton } from '../components/DialogActions';
import { Modal } from '../components/Modal';
import { Notice } from '../components/Notice';
import { QualityBadges } from '../components/QualityBadge';
import { StaleNotice } from '../components/StaleNotice';
import { useToast } from '../components/Toast';
import { useConfirmAction } from '../components/useConfirmAction';
import { catalogKeys, usePhotos, useUpdateCategory } from '../data/catalog';
import { expectUpdatedAt, isStale } from '../data/concurrency';
import { useCanMutate } from '../data/health';
import { photoWebpUrl } from '../data/images';
import { isLowResolution, photoQuality } from '../data/photoQuality';
import { cs } from '../i18n/cs';
import { fill } from '../i18n/format';
import { errorMessage } from '../i18n/messages';
import { CatalogError } from '../ports';
import { useImageBase } from '../ports-context';

interface Props {
  category: CategoryRow;
  /** Albums of the category that have photos, in display order. */
  albums: readonly AlbumRow[];
  /** The album the current choice lives in (opens there); the first album otherwise. */
  initialAlbumId: string | null;
  onClose: () => void;
}

const p = cs.categoryCover.picker;

export function CategoryCoverPicker({ category, albums, initialAlbumId, onClose }: Props) {
  const imgBase = useImageBase();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canMutate = useCanMutate();
  const update = useUpdateCategory();
  const startAlbum = albums.find((a) => a.id === initialAlbumId)?.id ?? albums[0]?.id ?? '';
  const [albumId, setAlbumId] = useState(startAlbum);
  const [photoId, setPhotoId] = useState<string>(category.cover_photo_id ?? '');
  const photos = usePhotos(albumId);

  const rows = photos.data ?? [];
  const chosen = rows.find((row) => row.id === photoId);

  const { saving, failure, confirm } = useConfirmAction(async () => {
    try {
      await update.mutateAsync({
        id: category.id,
        patch: { cover_photo_id: photoId },
        options: expectUpdatedAt(category),
      });
    } catch (error) {
      if (error instanceof CatalogError && error.code === 'CATEGORY_COVER_NOT_IN_CATEGORY') {
        await queryClient.invalidateQueries({ queryKey: catalogKeys.all });
      }
      throw error;
    }
    toast.show(cs.categoryCover.set);
    onClose();
  });

  function pickAlbum(id: string) {
    setAlbumId(id);
    setPhotoId('');
  }

  let grid;
  if (photos.isError) {
    grid = <Notice>{p.photosFailed}</Notice>;
  } else if (!photos.data) {
    grid = (
      <p className="page-note" role="status">
        {p.photosLoading}
      </p>
    );
  } else if (rows.length === 0) {
    grid = <p className="page-note">{p.photosEmpty}</p>;
  } else {
    grid = (
      <div className="cover-picker-grid">
        {rows.map((photo, index) => {
          const src = photoWebpUrl(imgBase, photo.id, 480);
          const name = fill(p.photoPosition, { n: index + 1, total: rows.length });
          return (
            <label key={photo.id} className="cover-tile">
              <input
                type="radio"
                name="cover-photo"
                className="visually-hidden"
                value={photo.id}
                checked={photoId === photo.id}
                onChange={() => setPhotoId(photo.id)}
              />
              {src ? <img src={src} width={480} height={480} alt={name} loading="lazy" decoding="async" /> : <span>{name}</span>}
              <span className="cover-tile-mark" aria-hidden="true">
                <svg viewBox="0 0 16 16" width="16" height="16" focusable="false">
                  <path d="M2.5 8.5 L6.5 12 L13.5 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <QualityBadges quality={photoQuality(photo)} hideGood />
            </label>
          );
        })}
      </div>
    );
  }

  return (
    <Modal title={p.title} onClose={onClose} busy={saving}>
      <div className="cover-picker">
        <p>{p.hint}</p>
        <fieldset className="cover-picker-albums">
          <legend>{p.albumLegend}</legend>
          {albums.map((a) => (
            <label key={a.id} className="picker-option">
              <input
                type="radio"
                name="cover-album"
                value={a.id}
                checked={albumId === a.id}
                data-autofocus={albumId === a.id ? '' : undefined}
                onChange={() => pickAlbum(a.id)}
              />
              <span>{a.published ? a.title : `${a.title} (${p.unpublished})`}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="cover-picker-photos" aria-busy={!photos.data && !photos.isError}>
          <legend>{p.photoLegend}</legend>
          {grid}
        </fieldset>
        {chosen && isLowResolution(chosen) ? <Notice variant="info">{p.lowWarning}</Notice> : null}
        {failure === null ? null : isStale(failure) ? (
          <StaleNotice entity="category" onReload={onClose} />
        ) : (
          <Notice>{errorMessage(failure)}</Notice>
        )}
        <DialogActions busy={saving} onClose={onClose}>
          <DialogButton
            kind="primary"
            busy={saving}
            announceBusy
            disabled={!canMutate || !chosen}
            onClick={() => void confirm()}
          >
            {saving ? p.saving : p.confirm}
          </DialogButton>
        </DialogActions>
      </div>
    </Modal>
  );
}
