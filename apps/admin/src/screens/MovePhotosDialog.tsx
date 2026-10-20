/** "Přesunout do alba" (F7): pick a target album (grouped by category, with search); the photos are appended at its end. */
import type { AlbumRow, CategoryRow } from '@mp/shared';
import { useId, useState } from 'react';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { groupAlbums } from '../data/albumSearch';
import { isStale } from '../data/concurrency';
import { useCanMutate } from '../data/health';
import { usePhotoActions } from '../data/photoActions';
import { cs, glossary } from '../i18n/cs';
import { fill, formatCount } from '../i18n/format';
import { errorMessage } from '../i18n/messages';
import { StaleNotice } from '../components/StaleNotice';

interface Props {
  /** The album the photos come from. */
  album: AlbumRow;
  /** Photos to move, in their order in the source album. */
  photoIds: readonly string[];
  categories: readonly CategoryRow[];
  albums: readonly AlbumRow[];
  onClose: () => void;
  onMoved: () => void;
}

export function MovePhotosDialog({ album, photoIds, categories, albums, onClose, onMoved }: Props) {
  const actions = usePhotoActions();
  const toast = useToast();
  const canMutate = useCanMutate();
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [targetId, setTargetId] = useState('');
  const [failure, setFailure] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const everyGroup = groupAlbums(categories, albums, album.id, '');
  const groups = groupAlbums(categories, albums, album.id, query);

  async function confirm() {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    try {
      const result = await actions.movePhotos(album, targetId, photoIds);
      toast.show(fill(cs.photos.moved, { count: formatCount(result.moved, cs.units.photo) }));
      if (result.coverReassigned) toast.show(cs.photos.coverReassigned);
      onMoved();
    } catch (error) {
      setFailure(error);
      setSaving(false);
    }
  }

  return (
    <Modal title={cs.photos.moveDialogTitle} onClose={onClose} busy={saving}>
      {everyGroup.length === 0 ? (
        <>
          <p>{cs.photos.noOtherAlbum}</p>
          <div className="dialog-actions">
            <button type="button" className="button button-primary" data-autofocus="" onClick={onClose}>
              {cs.categories.close}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>{cs.photos.moveDialogBody}</p>
          <div className="field">
            <label htmlFor={searchId}>{cs.photos.searchAlbums}</label>
            <input
              id={searchId}
              type="search"
              value={query}
              autoComplete="off"
              data-autofocus=""
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {groups.length === 0 ? <p className="page-note">{cs.photos.noAlbumMatch}</p> : null}
          <div className="album-picker">
            {groups.map((group) => (
              <fieldset key={group.category.id} className="picker-group">
                <legend>{group.category.name}</legend>
                {group.albums.map((a) => (
                  <label key={a.id} className="picker-option">
                    <input
                      type="radio"
                      name="target-album"
                      value={a.id}
                      checked={targetId === a.id}
                      onChange={() => setTargetId(a.id)}
                    />
                    <span>{a.title}</span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          {failure === null ? null : isStale(failure) ? (
            <StaleNotice entity="photo" onReload={onClose} />
          ) : (
            <p className="notice notice-error" role="alert">
              {errorMessage(failure)}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={!canMutate || targetId === ''}
              aria-disabled={saving || undefined}
              aria-busy={saving}
              onClick={() => void confirm()}
            >
              {saving ? cs.categories.saving : glossary.move}
            </button>
            <button type="button" className="button" aria-disabled={saving || undefined} onClick={() => !saving && onClose()}>
              {glossary.cancel}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
