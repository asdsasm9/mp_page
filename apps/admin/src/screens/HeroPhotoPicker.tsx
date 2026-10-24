/**
 * Picker of the home hero photo (WP-12 step 28, T-286), the pattern of the category cover picker (T-272): step 1 the
 * album (radio list), step 2 a photo of it (radio grid, native radios so the arrow keys move the choice). A photo that
 * is too small for the big hero can be chosen but shows "Nízké rozlišení pro velkou fotku". Saving PATCHes
 * site_settings.hero_photo_id; when the database says the photo no longer exists the lists are refreshed.
 */
import { HERO_MIN_MASTER_WIDTH, type AlbumRow } from '@mp/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { DialogActions, DialogButton } from '../components/DialogActions';
import { Modal } from '../components/Modal';
import { Notice } from '../components/Notice';
import { QualityBadges } from '../components/QualityBadge';
import { useToast } from '../components/Toast';
import { useConfirmAction } from '../components/useConfirmAction';
import { catalogKeys, usePhotos, useUpdateSiteSettings } from '../data/catalog';
import { useCanMutate } from '../data/health';
import { photoWebpUrl } from '../data/images';
import { isLowForHero, photoQuality } from '../data/photoQuality';
import { cs } from '../i18n/cs';
import { fill } from '../i18n/format';
import { errorMessage } from '../i18n/messages';
import { CatalogError } from '../ports';
import { useImageBase } from '../ports-context';

interface Props {
  /** Albums that have photos, in display order, with the label to show (category and album). */
  albums: readonly { album: AlbumRow; label: string }[];
  /** The album the current choice lives in (opens there); the first album otherwise. */
  initialAlbumId: string | null;
  currentPhotoId: string | null;
  onClose: () => void;
}

const p = cs.heroPhoto.picker;

export function HeroPhotoPicker({ albums, initialAlbumId, currentPhotoId, onClose }: Props) {
  const imgBase = useImageBase();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canMutate = useCanMutate();
  const update = useUpdateSiteSettings();
  const startAlbum = albums.find((a) => a.album.id === initialAlbumId)?.album.id ?? albums[0]?.album.id ?? '';
  const [albumId, setAlbumId] = useState(startAlbum);
  const [photoId, setPhotoId] = useState<string>(currentPhotoId ?? '');
  const photos = usePhotos(albumId);

  const rows = photos.data ?? [];
  const chosen = rows.find((row) => row.id === photoId);

  const { saving, failure, confirm } = useConfirmAction(async () => {
    try {
      await update.mutateAsync({ hero_photo_id: photoId });
    } catch (error) {
      if (error instanceof CatalogError && error.code === 'NOT_FOUND') {
        await queryClient.invalidateQueries({ queryKey: catalogKeys.all });
      }
      throw error;
    }
    toast.show(cs.heroPhoto.set);
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
                name="hero-photo"
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
          {albums.map(({ album, label }) => (
            <label key={album.id} className="picker-option">
              <input
                type="radio"
                name="hero-album"
                value={album.id}
                checked={albumId === album.id}
                data-autofocus={albumId === album.id ? '' : undefined}
                onChange={() => pickAlbum(album.id)}
              />
              <span>{album.published ? label : `${label} (${p.unpublished})`}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="cover-picker-photos" aria-busy={!photos.data && !photos.isError}>
          <legend>{p.photoLegend}</legend>
          {grid}
        </fieldset>
        {chosen && isLowForHero(chosen) ? (
          <Notice variant="info" as="div">
            <p>
              <strong>{cs.heroPhoto.lowResolution}</strong>
            </p>
            <p>{fill(cs.heroPhoto.lowResolutionHint, { min: HERO_MIN_MASTER_WIDTH })}</p>
          </Notice>
        ) : null}
        {failure === null ? null : <Notice>{errorMessage(failure)}</Notice>}
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
