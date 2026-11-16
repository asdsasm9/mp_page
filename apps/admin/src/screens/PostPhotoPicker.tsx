/**
 * Photo picker of the Instagram post editor (WP-14), modelled on HeroPhotoPicker: step 1 the album (radio list), step 2
 * the photos of it (checkboxes, each selected one shows its order number). The selection is one list across albums,
 * in the order the photos were picked, at most IG_PHOTOS_MAX; the editor keeps the order it gets back.
 */
import { IG_PHOTOS_MAX } from '@mp/shared';
import { useMemo, useState } from 'react';
import { DialogActions, DialogButton } from '../components/DialogActions';
import { Modal } from '../components/Modal';
import { Notice } from '../components/Notice';
import { useAlbums, useCategories, usePhotos } from '../data/catalog';
import { photoWebpUrl } from '../data/images';
import { cs } from '../i18n/cs';
import { fill } from '../i18n/format';
import { useImageBase } from '../ports-context';

interface Props {
  /** Photo ids already in the post, in carousel order. */
  selected: readonly string[];
  onConfirm: (photoIds: string[]) => void;
  onClose: () => void;
}

const p = cs.instagram.picker;

export function PostPhotoPicker({ selected, onConfirm, onClose }: Props) {
  const imgBase = useImageBase();
  const categories = useCategories();
  const albums = useAlbums();
  const [chosen, setChosen] = useState<string[]>([...selected]);
  const [albumId, setAlbumId] = useState('');

  const options = useMemo(() => {
    const rank = new Map((categories.data ?? []).map((c, i) => [c.id, i] as const));
    const names = new Map((categories.data ?? []).map((c) => [c.id, c.name] as const));
    return [...(albums.data ?? [])]
      .sort((a, b) => (rank.get(a.category_id) ?? 0) - (rank.get(b.category_id) ?? 0) || a.sort - b.sort)
      .map((album) => ({ album, label: `${names.get(album.category_id) ?? ''} · ${album.title}` }));
  }, [albums.data, categories.data]);

  const currentAlbum = albumId || options[0]?.album.id || '';
  const photos = usePhotos(currentAlbum);
  const rows = photos.data ?? [];
  const full = chosen.length >= IG_PHOTOS_MAX;

  function toggle(id: string) {
    setChosen((now) => (now.includes(id) ? now.filter((x) => x !== id) : now.length >= IG_PHOTOS_MAX ? now : [...now, id]));
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
          const order = chosen.indexOf(photo.id) + 1;
          return (
            <label key={photo.id} className="cover-tile">
              <input
                type="checkbox"
                className="visually-hidden"
                value={photo.id}
                checked={order > 0}
                disabled={order === 0 && full}
                onChange={() => toggle(photo.id)}
              />
              {src ? <img src={src} width={480} height={480} alt={name} loading="lazy" decoding="async" /> : <span>{name}</span>}
              {order > 0 ? (
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
    <Modal title={p.title} onClose={onClose}>
      <div className="cover-picker">
        <p>{p.hint}</p>
        {options.length === 0 ? (
          <p className="page-note">{categories.isSuccess && albums.isSuccess ? p.noAlbums : cs.data.loading}</p>
        ) : (
          <fieldset className="cover-picker-albums">
            <legend>{p.albumLegend}</legend>
            {options.map(({ album, label }) => (
              <label key={album.id} className="picker-option">
                <input
                  type="radio"
                  name="post-album"
                  value={album.id}
                  checked={currentAlbum === album.id}
                  data-autofocus={currentAlbum === album.id ? '' : undefined}
                  onChange={() => setAlbumId(album.id)}
                />
                <span>{album.published ? label : `${label} (${p.unpublished})`}</span>
              </label>
            ))}
          </fieldset>
        )}
        {options.length === 0 ? null : (
          <fieldset className="cover-picker-photos" aria-busy={!photos.data && !photos.isError}>
            <legend>{p.photoLegend}</legend>
            {grid}
          </fieldset>
        )}
        <p className="page-note" role="status" aria-live="polite">
          {fill(cs.instagram.editor.selectedCount, { n: chosen.length, max: IG_PHOTOS_MAX })}
          {full ? ` ${fill(p.limitReached, { max: IG_PHOTOS_MAX })}` : ''}
        </p>
        <DialogActions busy={false} onClose={onClose}>
          <DialogButton kind="primary" busy={false} disabled={chosen.length === 0} onClick={() => onConfirm(chosen)}>
            {p.confirm}
          </DialogButton>
        </DialogActions>
      </div>
    </Modal>
  );
}
