/**
 * Photos of one album (ADMIN-UX 3.4, F2, F3, F7): grid, "bez alternativního textu" filter, tile menu (bottom
 * sheet on a phone), reordering by drag only (pointer, long press, keyboard sensor), selection mode and
 * "Přesunout do alba".
 */
import type { AlbumRow, CategoryRow, PhotoRow } from '@mp/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '../components/Modal';
import { PhotoGrid } from '../components/PhotoGrid';
import { StaleNotice } from '../components/StaleNotice';
import { useToast } from '../components/Toast';
import { usePhotoReorder } from '../components/usePhotoReorder';
import { hasNoAlt } from '../data/altText';
import { isStale } from '../data/concurrency';
import { useCanMutate } from '../data/health';
import type { SortUpdate } from '../data/order';
import { usePhotoActions } from '../data/photoActions';
import { cs, glossary } from '../i18n/cs';
import { fill, formatCount, plural } from '../i18n/format';
import { errorMessage } from '../i18n/messages';
import { useImageBase } from '../ports-context';
import { planDragEnd } from '../components/SortableList';
import { usePhotoDeleter, type DeleteOutcome } from '../data/deleteActions';
import { DeletePhotosDialog } from './DeleteDialogs';
import { MovePhotosDialog } from './MovePhotosDialog';

interface Props {
  album: AlbumRow;
  photos: readonly PhotoRow[];
  categories: readonly CategoryRow[];
  albums: readonly AlbumRow[];
}

interface MenuProps {
  photo: PhotoRow;
  position: number;
  total: number;
  isCover: boolean;
  canMove: boolean;
  onClose: () => void;
  onCover: () => void;
  onMoveAlbum: () => void;
  onDelete: () => void;
  detailPath: string;
}

/** Tile menu: a dialog that is a bottom sheet on a phone. */
function TileMenu(props: MenuProps) {
  const canMutate = useCanMutate();
  return (
    <Modal title={fill(cs.photos.menuTitle, { n: props.position })} onClose={props.onClose} variant="sheet">
      <div className="menu-list">
        {props.isCover ? null : (
          <button type="button" className="button" disabled={!canMutate} onClick={props.onCover}>
            {glossary.setAsCover}
          </button>
        )}
        <Link className="button" to={props.detailPath}>
          {cs.photos.editCaption}
        </Link>
        {props.canMove ? (
          <>
            <button type="button" className="button" disabled={!canMutate} onClick={props.onMoveAlbum}>
              {cs.photos.moveToOtherAlbum}
            </button>
          </>
        ) : null}
        <button type="button" className="button button-danger" disabled={!canMutate} onClick={props.onDelete}>
          {cs.delete.photo}
        </button>
        <button type="button" className="button" onClick={props.onClose}>
          {cs.photos.close}
        </button>
      </div>
    </Modal>
  );
}

export function PhotoGallery({ album, photos, categories, albums }: Props) {
  const imgBase = useImageBase();
  const toast = useToast();
  const canMutate = useCanMutate();
  const actions = usePhotoActions();
  const reorder = usePhotoReorder(photos);
  const [filterOn, setFilterOn] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [moveIds, setMoveIds] = useState<string[] | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const deleter = usePhotoDeleter();
  /** Rows to delete, fixed when the dialog opens (the list refreshes while the chunks run). */
  const [deleteTarget, setDeleteTarget] = useState<PhotoRow[] | null>(null);
  const [deleteFailedIds, setDeleteFailedIds] = useState<string[]>([]);
  const [retrying, setRetrying] = useState(false);

  const displayed = reorder.displayed;
  const missing = photos.filter(hasNoAlt);
  const filtering = filterOn && missing.length > 0;
  const visibleIds = filtering ? new Set(missing.map((p) => p.id)) : null;
  const positionIn = (rows: readonly PhotoRow[], id: string) => rows.findIndex((p) => p.id === id) + 1;
  const announce = (id: string) => (rows: PhotoRow[]) =>
    fill(cs.reorder.dropped, {
      name: fill(cs.photos.tileName, { n: positionIn(rows, id) }),
      position: positionIn(rows, id),
      total: rows.length,
    });

  function move(updates: SortUpdate[], id: string) {
    void reorder.commit(updates, announce(id));
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function startSelecting(id?: string) {
    setSelecting(true);
    setSelected(id ? new Set([id]) : new Set());
  }
  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }

  async function setCover(id: string) {
    setMenuFor(null);
    setActionError(null);
    try {
      await actions.setCover(album, id);
      toast.show(cs.photos.coverSet);
    } catch (error) {
      setActionError(error);
    }
  }

  const menuPhoto = menuFor ? displayed.find((p) => p.id === menuFor) : undefined;
  const selectedIds = displayed.filter((p) => selected.has(p.id)).map((p) => p.id);

  function finishDelete(outcome: DeleteOutcome) {
    setDeleteTarget(null);
    setDeleteFailedIds(outcome.failedIds);
    if (outcome.failedIds.length === 0) stopSelecting();
    else setSelected((current) => new Set([...current].filter((id) => outcome.failedIds.includes(id))));
  }

  async function retryDelete() {
    setRetrying(true);
    const outcome = await deleter.deletePhotos(
      album,
      deleteFailedIds.map((id) => ({ id, bytes_total: 0 })),
    );
    setRetrying(false);
    setDeleteFailedIds(outcome.failedIds);
    if (outcome.failedIds.length === 0) toast.show(cs.delete.retried);
  }

  const deleteFailure =
    deleteFailedIds.length > 0 ? (
      <div className="notice notice-error" role="alert">
        <p>{cs.delete.failed}</p>
        <button type="button" className="button" disabled={!canMutate || retrying} onClick={() => void retryDelete()}>
          {retrying ? cs.delete.progress : glossary.retry}
        </button>
      </div>
    ) : null;

  if (photos.length === 0)
    return (
      <>
        <p className="page-note">{cs.album.photosEmpty}</p>
        {deleteFailure}
      </>
    );

  return (
    <div className="gallery">
      <div className="gallery-toolbar">
        <p className="page-note">{formatCount(photos.length, cs.units.photo)}</p>
        {missing.length > 0 ? (
          <button type="button" className="button" aria-pressed={filtering} onClick={() => setFilterOn(!filterOn)}>
            {fill(plural(missing.length, cs.photos.missingAlt), { count: missing.length })}
          </button>
        ) : null}
        {selecting ? null : (
          <button type="button" className="button" disabled={!canMutate} onClick={() => startSelecting()}>
            {cs.photos.select}
          </button>
        )}
      </div>
      {selecting ? null : <p className="field-hint">{cs.photos.longPressHint}</p>}
      <PhotoGrid
        photos={displayed}
        visibleIds={visibleIds}
        coverId={album.cover_photo_id}
        imgBase={imgBase}
        albumId={album.id}
        selecting={selecting}
        selected={selected}
        busy={reorder.busy}
        failedIds={new Set(deleteFailedIds)}
        onToggle={toggle}
        onLongPress={(id) => startSelecting(id)}
        onMenu={setMenuFor}
        onDrop={(active, over) => move(planDragEnd(displayed, active, over), active)}
        onSpeak={reorder.setSpoken}
      />
      <p className="visually-hidden" role="status" aria-live="polite">
        {reorder.spoken}
      </p>
      {reorder.failure ? (
        isStale(reorder.failure.error) ? (
          <StaleNotice entity="photo" onReload={reorder.dismissFailure} />
        ) : (
          <div className="notice notice-error" role="alert">
            <p>{cs.reorder.failed}</p>
            <button
              type="button"
              className="button"
              disabled={!canMutate}
              onClick={() => void reorder.commit(reorder.failure!.updates)}
            >
              {glossary.retry}
            </button>
          </div>
        )
      ) : null}
      {deleteFailure}
      {actionError === null ? null : isStale(actionError) ? (
        <StaleNotice entity="album" onReload={() => setActionError(null)} />
      ) : (
        <p className="notice notice-error" role="alert">
          {errorMessage(actionError)}
        </p>
      )}
      {selecting ? (
        <div className="selection-bar" role="region" aria-label={cs.photos.selectionBar}>
          <p role="status" className="selection-count">
            {fill(cs.photos.selected, { count: selected.size })}
          </p>
          <button
            type="button"
            className="button button-primary"
            disabled={!canMutate || selected.size === 0}
            onClick={() => setMoveIds(selectedIds)}
          >
            {glossary.moveToAlbum}
          </button>
          <button
            type="button"
            className="button button-danger"
            disabled={!canMutate || selected.size === 0}
            onClick={() => setDeleteTarget(displayed.filter((p) => selected.has(p.id)))}
          >
            {fill(cs.delete.selected, { count: selected.size })}
          </button>
          <button type="button" className="button" onClick={stopSelecting}>
            {cs.photos.clearSelection}
          </button>
        </div>
      ) : null}
      {menuPhoto ? (
        <TileMenu
          photo={menuPhoto}
          position={positionIn(displayed, menuPhoto.id)}
          total={displayed.length}
          isCover={album.cover_photo_id === menuPhoto.id}
          canMove={!filtering}
          detailPath={`/alba/${album.id}/foto/${menuPhoto.id}`}
          onClose={() => setMenuFor(null)}
          onCover={() => void setCover(menuPhoto.id)}
          onMoveAlbum={() => {
            setMenuFor(null);
            setMoveIds([menuPhoto.id]);
          }}
          onDelete={() => {
            setMenuFor(null);
            setDeleteTarget([menuPhoto]);
          }}
        />
      ) : null}
      {deleteTarget && deleteTarget.length > 0 ? (
        <DeletePhotosDialog album={album} photos={deleteTarget} onClose={() => setDeleteTarget(null)} onFinished={finishDelete} />
      ) : null}
      {moveIds ? (
        <MovePhotosDialog
          album={album}
          photoIds={moveIds}
          categories={categories}
          albums={albums}
          onClose={() => setMoveIds(null)}
          onMoved={() => {
            setMoveIds(null);
            stopSelecting();
          }}
        />
      ) : null}
    </div>
  );
}
