/** Category detail (`/kategorie/:id`, ADMIN-UX 3.3): the albums of one category with cover, status, counts, actions, reorder. */
import type { AlbumRow, CategoryRow } from '@mp/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Breadcrumb } from '../components/Breadcrumb';
import { CoverThumb } from '../components/CoverThumb';
import { LoadFailure } from '../components/LoadFailure';
import { useDocumentTitle } from '../components/Page';
import { SortableList } from '../components/SortableList';
import { StaleNotice } from '../components/StaleNotice';
import { albumActionMessage, useAlbumActions } from '../data/albumActions';
import { albumStatus } from '../data/albumStatus';
import { catalogKeys, useAlbums, useCategories, useCategory, usePhotosByAlbum, useUpdateAlbum } from '../data/catalog';
import { expectUpdatedAt, isStale } from '../data/concurrency';
import { useCanMutate } from '../data/health';
import { photoWebpUrl } from '../data/images';
import type { SortUpdate } from '../data/order';
import { cs, glossary } from '../i18n/cs';
import { formatCount, formatShotOn } from '../i18n/format';
import { useImageBase } from '../ports-context';
import { HideAlbumDialog, MoveAlbumDialog, NewAlbumDialog } from './AlbumDialogs';
import { CategoryFormDialog, DeleteCategoryDialog } from './CategoryDialogs';
import { DeleteAlbumDialog } from './DeleteDialogs';

type DialogState =
  | { kind: 'new' | 'edit' | 'deleteCategory' }
  | { kind: 'hide' | 'move' | 'delete'; id: string }
  | null;

function CategoryBody({ category }: { category: CategoryRow }) {
  useDocumentTitle(category.name);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const categories = useCategories();
  const albums = useAlbums();
  const update = useUpdateAlbum();
  const actions = useAlbumActions();
  const canMutate = useCanMutate();
  const imgBase = useImageBase();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const allAlbums = useMemo(() => albums.data ?? [], [albums.data]);
  const own = useMemo(() => allAlbums.filter((a) => a.category_id === category.id), [allAlbums, category.id]);
  const ownRef = useRef(own);
  ownRef.current = own;
  const photos = usePhotosByAlbum(useMemo(() => own.map((a) => a.id), [own]));

  async function reorder(updates: SortUpdate[]) {
    const byId = new Map(ownRef.current.map((a) => [a.id, a] as const));
    try {
      await Promise.all(
        updates.flatMap((u) => {
          const row = byId.get(u.id);
          return row ? [update.mutateAsync({ id: u.id, patch: { sort: u.sort }, options: expectUpdatedAt(row) })] : [];
        }),
      );
    } catch (error) {
      // Some of the rows may have been written: show what the database has now.
      await queryClient.invalidateQueries({ queryKey: catalogKeys.albums() });
      throw error;
    }
  }

  async function publish(album: AlbumRow) {
    setActionError(null);
    try {
      await actions.publish(album);
    } catch (error) {
      setActionError(error);
    }
  }

  function metaOf(album: AlbumRow): string {
    const list = photos.get(album.id);
    const parts = [
      album.place,
      album.shot_on ? formatShotOn(album.shot_on) : null,
      list ? formatCount(list.length, cs.units.photo) : null,
    ].filter((part): part is string => part !== null && part !== '');
    return parts.join(cs.albums.separator);
  }

  function coverOf(album: AlbumRow): string | null {
    const cover = photos.get(album.id)?.find((p) => p.id === album.cover_photo_id);
    return cover ? photoWebpUrl(imgBase, cover.id) : null;
  }

  const current =
    dialog && (dialog.kind === 'hide' || dialog.kind === 'move' || dialog.kind === 'delete')
      ? own.find((a) => a.id === dialog.id)
      : undefined;
  const closeDialog = () => setDialog(null);

  let list;
  if (albums.isError) {
    list = (
      <LoadFailure error={albums.error} message={cs.categoryDetail.albumsLoadFailed} onRetry={() => void albums.refetch()} />
    );
  } else if (!albums.data) {
    list = (
      <p role="status" aria-busy="true" className="page-note">
        {cs.data.loading}
      </p>
    );
  } else if (own.length === 0) {
    list = (
      <div className="empty-state">
        <p>{cs.categoryDetail.empty}</p>
        <button type="button" className="button button-primary" disabled={!canMutate} onClick={() => setDialog({ kind: 'new' })}>
          {glossary.newAlbum}
        </button>
      </div>
    );
  } else {
    list = (
      <SortableList
        items={own}
        label={cs.categoryDetail.listLabel}
        itemLabel={(a) => a.title}
        onReorder={reorder}
        staleEntity="album"
        renderItem={(a) => {
          const status = albumStatus(a);
          return (
            <>
              <CoverThumb src={coverOf(a)} />
              <div className="album-info">
                <Link to={`/alba/${a.id}`} className="row-title">
                  {a.title}
                </Link>
                <span className="badge" data-state={status}>
                  {status === 'published' ? glossary.published : cs.albums.unpublished}
                </span>
                <span className="row-meta">{metaOf(a)}</span>
              </div>
            </>
          );
        }}
        renderActions={(a) => (
          <>
            <Link to={`/alba/${a.id}`} className="button" aria-label={`${cs.categoryDetail.open}: ${a.title}`}>
              {cs.categoryDetail.open}
            </Link>
            {a.published ? (
              <button
                type="button"
                className="button"
                aria-label={`${glossary.hideAlbum}: ${a.title}`}
                disabled={!canMutate}
                onClick={() => setDialog({ kind: 'hide', id: a.id })}
              >
                {glossary.hideAlbum}
              </button>
            ) : (
              <button
                type="button"
                className="button"
                aria-label={`${glossary.publishAlbum}: ${a.title}`}
                disabled={!canMutate}
                onClick={() => void publish(a)}
              >
                {glossary.publishAlbum}
              </button>
            )}
            <button
              type="button"
              className="button"
              aria-label={`${cs.categoryDetail.moveToCategory}: ${a.title}`}
              disabled={!canMutate || (categories.data?.length ?? 0) < 2}
              onClick={() => setDialog({ kind: 'move', id: a.id })}
            >
              {cs.categoryDetail.moveToCategory}
            </button>
            <button
              type="button"
              className="button button-danger"
              aria-label={`${cs.delete.album}: ${a.title}`}
              disabled={!canMutate || !photos.get(a.id)}
              onClick={() => setDialog({ kind: 'delete', id: a.id })}
            >
              {glossary.delete}
            </button>
          </>
        )}
      />
    );
  }

  return (
    <div className="page">
      <Breadcrumb items={[{ label: cs.nav.categories, to: '/' }, { label: category.name }]} />
      <div className="page-header">
        <h1>{category.name}</h1>
        <div className="header-actions">
          <span className="badge" data-state={category.visible ? 'visible' : 'hidden'}>
            {category.visible ? glossary.visible : glossary.hiddenCategory}
          </span>
          <button type="button" className="button" disabled={!canMutate} onClick={() => setDialog({ kind: 'edit' })}>
            {cs.categoryDetail.edit}
          </button>
          <button
            type="button"
            className="button button-danger"
            disabled={!canMutate || !albums.data}
            onClick={() => setDialog({ kind: 'deleteCategory' })}
          >
            {cs.delete.category}
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={!canMutate || !albums.data}
            onClick={() => setDialog({ kind: 'new' })}
          >
            {glossary.newAlbum}
          </button>
        </div>
      </div>
      {actionError === null ? null : isStale(actionError) ? (
        <StaleNotice entity="album" onReload={() => setActionError(null)} />
      ) : (
        <p className="notice notice-error" role="alert">
          {albumActionMessage(actionError)}
        </p>
      )}
      {list}
      {dialog?.kind === 'new' ? (
        <NewAlbumDialog
          categories={categories.data ?? [category]}
          albums={allAlbums}
          defaultCategoryId={category.id}
          onClose={closeDialog}
          onCreated={(album) => navigate(`/alba/${album.id}`)}
        />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <CategoryFormDialog category={category} categories={categories.data ?? [category]} onClose={closeDialog} />
      ) : null}
      {dialog?.kind === 'deleteCategory' ? (
        <DeleteCategoryDialog
          category={category}
          albumCount={own.length}
          onClose={closeDialog}
          onDeleted={() => navigate('/')}
        />
      ) : null}
      {dialog?.kind === 'delete' && current ? (
        <DeleteAlbumDialog
          album={current}
          photoCount={photos.get(current.id)?.length ?? 0}
          onClose={closeDialog}
          onDeleted={closeDialog}
        />
      ) : null}
      {dialog?.kind === 'hide' && current ? <HideAlbumDialog album={current} onClose={closeDialog} /> : null}
      {dialog?.kind === 'move' && current ? (
        <MoveAlbumDialog album={current} categories={categories.data ?? []} albums={allAlbums} onClose={closeDialog} />
      ) : null}
    </div>
  );
}

export function CategoryScreen() {
  const { id = '' } = useParams();
  const category = useCategory(id);
  useDocumentTitle(category.data?.name ?? cs.routes.category.title);

  if (category.isError) {
    return (
      <div className="page">
        <h1>{cs.routes.category.title}</h1>
        <LoadFailure error={category.error} message={cs.categoryDetail.loadFailed} onRetry={() => void category.refetch()} />
      </div>
    );
  }
  if (!category.data) {
    return (
      <div className="page">
        <h1>{cs.routes.category.title}</h1>
        {category.isSuccess ? (
          <>
            <p className="page-note">{cs.categoryDetail.notFound}</p>
            <p>
              <Link to="/">{cs.notFound.back}</Link>
            </p>
          </>
        ) : (
          <p role="status" aria-busy="true" className="page-note">
            {cs.data.loading}
          </p>
        )}
      </div>
    );
  }
  return <CategoryBody key={category.data.id} category={category.data} />;
}
