/**
 * Photo picker of the Instagram post editor (WP-14), modelled on HeroPhotoPicker: step 1 the album (native select, grouped by category), step 2
 * the photos of it (checkboxes, each selected one shows its order number). The selection is one list across albums,
 * in the order the photos were picked, at most IG_PHOTOS_MAX; the editor keeps the order it gets back.
 */
import { IG_PHOTOS_MAX } from '@mp/shared';
import { useId, useMemo, useState } from 'react';
import { DialogActions, DialogButton } from '../components/DialogActions';
import { Modal } from '../components/Modal';
import { Notice } from '../components/Notice';
import { useAlbums, useCategories, usePhotos } from '../data/catalog';
import { fallbackTo480OnError, photoImgProps } from '../data/images';
import { cs } from '../i18n/cs';
import { fill } from '../i18n/format';
import { useImageBase } from '../ports-context';

interface Props {
  /** Photo ids already in the post, in carousel order. */
  selected: readonly string[];
  onConfirm: (photoIds: string[]) => void;
  onClose: () => void;
  /** Most photos that can be chosen (default IG_PHOTOS_MAX). 1 = single choice (the profile photo): native radios, a new pick replaces the old one. */
  max?: number;
  title?: string;
  hint?: string;
}

const p = cs.instagram.picker;

export function PostPhotoPicker({ selected, onConfirm, onClose, max = IG_PHOTOS_MAX, title = p.title, hint = p.hint }: Props) {
  const single = max === 1;
  const imgBase = useImageBase();
  const categories = useCategories();
  const albums = useAlbums();
  const [chosen, setChosen] = useState<string[]>([...selected]);
  const [albumId, setAlbumId] = useState('');
  const albumSelectId = useId();

  /** Albums grouped by category (category order, then album order); a category without albums has no group. */
  const groups = useMemo(() => {
    const all = albums.data ?? [];
    return (categories.data ?? [])
      .map((category) => ({
        id: category.id,
        name: category.name,
        albums: all.filter((album) => album.category_id === category.id).sort((a, b) => a.sort - b.sort),
      }))
      .filter((group) => group.albums.length > 0);
  }, [albums.data, categories.data]);

  const firstAlbum = groups[0]?.albums[0]?.id ?? '';
  const currentAlbum = albumId || firstAlbum;
  const albumCount = groups.reduce((sum, group) => sum + group.albums.length, 0);
  const photos = usePhotos(currentAlbum);
  const rows = photos.data ?? [];
  const full = !single && chosen.length >= max;

  function toggle(id: string) {
    if (single) setChosen([id]);
    else setChosen((now) => (now.includes(id) ? now.filter((x) => x !== id) : now.length >= max ? now : [...now, id]));
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
          const img = photoImgProps(imgBase, photo.id, 'picker');
          const name = fill(p.photoPosition, { n: index + 1, total: rows.length });
          const order = chosen.indexOf(photo.id) + 1;
          return (
            <label key={photo.id} className="cover-tile">
              <input
                type={single ? 'radio' : 'checkbox'}
                name={single ? 'post-photo-single' : undefined}
                className="visually-hidden"
                value={photo.id}
                checked={order > 0}
                disabled={order === 0 && full}
                onChange={() => toggle(photo.id)}
              />
              {img ? (
                <img {...img} width={165} height={165} alt={name} loading="lazy" decoding="async" onError={fallbackTo480OnError} />
              ) : (
                <span>{name}</span>
              )}
              {order > 0 && single ? (
                <span className="cover-tile-mark" aria-hidden="true">
                  <svg viewBox="0 0 16 16" width="16" height="16" focusable="false">
                    <path d="M2.5 8.5 L6.5 12 L13.5 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              ) : order > 0 ? (
                <>
                  <span className="cover-tile-mark ig-pick-order" aria-hidden="true">
                    {order}
                  </span>
                  <span className="visually-hidden">{fill(p.chosenAs, { n: order })}</span>
                </>
              ) : null}
            </label>
          );
        })}
      </div>
    );
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="cover-picker">
        <p>{hint}</p>
        {albumCount === 0 ? (
          <p className="page-note">{categories.isSuccess && albums.isSuccess ? p.noAlbums : cs.data.loading}</p>
        ) : (
          <div className="field">
            <label htmlFor={albumSelectId}>{p.albumLabel}</label>
            <select id={albumSelectId} value={currentAlbum} data-autofocus="" onChange={(event) => setAlbumId(event.target.value)}>
              {groups.map((group) => (
                <optgroup key={group.id} label={group.name}>
                  {group.albums.map((album) => (
                    <option key={album.id} value={album.id}>
                      {album.published ? album.title : `${album.title} (${p.unpublished})`}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}
        {albumCount === 0 ? null : (
          <fieldset className="cover-picker-photos" aria-busy={!photos.data && !photos.isError}>
            <legend>{p.photoLegend}</legend>
            {grid}
          </fieldset>
        )}
        {single ? null : (
          <p className="page-note" role="status" aria-live="polite">
            {fill(cs.instagram.editor.selectedCount, { n: chosen.length, max })}
            {full ? ` ${fill(p.limitReached, { max })}` : ''}
          </p>
        )}
        <DialogActions busy={false} onClose={onClose}>
          <DialogButton kind="primary" busy={false} disabled={chosen.length === 0} onClick={() => onConfirm(chosen)}>
            {p.confirm}
          </DialogButton>
        </DialogActions>
      </div>
    </Modal>
  );
}
