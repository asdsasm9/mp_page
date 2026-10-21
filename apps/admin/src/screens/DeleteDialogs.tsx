/** Delete dialogs (ADMIN-UX F5): photos (light confirmation) and album (typed name or "SMAZAT"). */
import type { AlbumRow, PhotoRow } from '@mp/shared';
import { useId, useState } from 'react';
import { DialogActions, DialogButton } from '../components/DialogActions';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { useAlbumActions } from '../data/albumActions';
import { useAlbumDeleter, usePhotoDeleter, type DeleteOutcome } from '../data/deleteActions';
import { useCanMutate } from '../data/health';
import { cs, glossary } from '../i18n/cs';
import { fill, formatBytes, formatCount, plural } from '../i18n/format';
import { errorMessage } from '../i18n/messages';

interface PhotosProps {
  album: AlbumRow;
  photos: readonly PhotoRow[];
  onClose: () => void;
  /** Called after the loop ended, with failures if any (the caller shows them); the dialog is then closed by the caller. */
  onFinished: (outcome: DeleteOutcome) => void;
}

export function DeletePhotosDialog({ album, photos, onClose, onFinished }: PhotosProps) {
  const deleter = usePhotoDeleter();
  const toast = useToast();
  const canMutate = useCanMutate();
  const [deleting, setDeleting] = useState(false);
  const count = photos.length;

  async function confirm() {
    if (deleting) return;
    setDeleting(true);
    const outcome = await deleter.deletePhotos(album, photos);
    if (outcome.removedIds.length > 0 && outcome.failedIds.length === 0) {
      toast.show(
        fill(plural(outcome.removedIds.length, cs.delete.photosDone), {
          count: formatCount(outcome.removedIds.length, cs.units.photo),
          freed: formatBytes(outcome.freedBytes),
        }),
      );
    }
    if (outcome.coverReassigned) toast.show(cs.photos.coverReassigned);
    onFinished(outcome);
  }

  return (
    <Modal title={fill(plural(count, cs.delete.photosTitle), { count })} onClose={onClose} busy={deleting}>
      <p>{count === 1 ? cs.delete.photosBodyOne : cs.delete.photosBodyMany}</p>
      <DialogActions busy={deleting} onClose={onClose} cancelAutofocus>
        <DialogButton kind="danger" busy={deleting} announceBusy disabled={!canMutate} onClick={() => void confirm()}>
          {deleting ? cs.delete.progress : glossary.delete}
        </DialogButton>
      </DialogActions>
    </Modal>
  );
}

interface AlbumProps {
  album: AlbumRow;
  photoCount: number;
  onClose: () => void;
  /** The album row is gone. */
  onDeleted: () => void;
}

/** The typed text enables the button when it is the album title or the word SMAZAT. */
export function confirmsAlbumDelete(typed: string, title: string): boolean {
  const text = typed.trim();
  return text !== '' && (text === title.trim() || text === cs.delete.confirmWord);
}

export function DeleteAlbumDialog({ album, photoCount: openedWith, onClose, onDeleted }: AlbumProps) {
  // The count is read once: the lists refresh while the chunks are deleted and the title must not change under the user.
  const [photoCount] = useState(openedWith);
  const deleter = useAlbumDeleter();
  const albumActions = useAlbumActions();
  const toast = useToast();
  const canMutate = useCanMutate();
  const inputId = useId();
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [failure, setFailure] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const title =
    photoCount === 0
      ? fill(cs.delete.albumTitleEmpty, { title: album.title })
      : photoCount === 1
        ? fill(cs.delete.albumTitleOne, { title: album.title })
        : fill(cs.delete.albumTitleMany, { title: album.title, photos: formatCount(photoCount, cs.units.photo) });

  async function confirm() {
    if (deleting) return;
    setDeleting(true);
    setFailure(false);
    setError(null);
    try {
      const result = await deleter.deleteAlbum(album, failedIds);
      if (result.albumDeleted) {
        toast.show(fill(cs.delete.albumDone, { freed: formatBytes(result.freedBytes) }));
        onDeleted();
        return;
      }
      setFailedIds(result.failedIds);
      setFailure(true);
    } catch (e) {
      setError(e);
      setFailure(true);
    }
    setDeleting(false);
  }

  async function hide() {
    if (deleting) return;
    setDeleting(true);
    try {
      await albumActions.hide(album);
      onClose();
    } catch (e) {
      setError(e);
      setDeleting(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} busy={deleting}>
      <div className="field">
        <label htmlFor={inputId}>{cs.delete.albumConfirmLabel}</label>
        <input
          id={inputId}
          type="text"
          value={typed}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          data-autofocus=""
          readOnly={deleting}
          onChange={(event) => setTyped(event.target.value)}
        />
      </div>
      {failure ? (
        <p className="notice notice-error" role="alert">
          {cs.delete.failed}
          {error !== null ? ` ${errorMessage(error)}` : ''}
        </p>
      ) : null}
      <DialogActions busy={deleting} onClose={onClose}>
        <DialogButton
          kind="danger"
          busy={deleting}
          announceBusy
          disabled={!canMutate || !confirmsAlbumDelete(typed, album.title)}
          onClick={() => void confirm()}
        >
          {deleting ? cs.delete.progress : failure ? glossary.retry : cs.delete.album}
        </DialogButton>
        {album.published ? (
          <DialogButton busy={deleting} disabled={!canMutate} onClick={() => void hide()}>
            {glossary.hideAlbum}
          </DialogButton>
        ) : null}
      </DialogActions>
    </Modal>
  );
}
