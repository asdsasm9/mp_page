/** Album detail (`/alba/:id`, ADMIN-UX 3.4): inline title, status and actions, data panel, drop zone placeholder. */
import type { AlbumRow, CategoryRow } from '@mp/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Breadcrumb } from '../components/Breadcrumb';
import { LoadFailure } from '../components/LoadFailure';
import { useDocumentTitle } from '../components/Page';
import { StaleNotice } from '../components/StaleNotice';
import { albumActionMessage, useAlbumActions } from '../data/albumActions';
import { albumStatus } from '../data/albumStatus';
import { useAlbum, useAlbums, useCategories, useCategory, usePhotos } from '../data/catalog';
import { isStale } from '../data/concurrency';
import { useCanMutate } from '../data/health';
import { cs, glossary } from '../i18n/cs';
import { AlbumDataPanel, SaveStatus } from './AlbumDataPanel';
import { HideAlbumDialog, MoveAlbumDialog } from './AlbumDialogs';
import { PhotoGallery } from './PhotoGallery';
import { useAlbumAutosave } from './useAlbumAutosave';

type Autosave = ReturnType<typeof useAlbumAutosave>;

/** The title as a heading with a "Prejmenovat album" button that turns it into a field saved on blur / Enter. */
function InlineTitle({ album, autosave }: { album: AlbumRow; autosave: Autosave }) {
  const [editing, setEditing] = useState(false);
  const canMutate = useCanMutate();
  const error = autosave.errors.title;

  function finish() {
    if (autosave.commit('title')) setEditing(false);
  }

  if (!editing) {
    return (
      <div className="inline-title">
        <h1>{album.title}</h1>
        <button type="button" className="button" disabled={!canMutate} onClick={() => setEditing(true)}>
          {cs.album.rename}
        </button>
      </div>
    );
  }
  return (
    <div className="inline-title">
      <input
        type="text"
        ref={autosave.register('title')}
        aria-label={cs.album.titleLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'album-title-error' : undefined}
        value={autosave.values.title}
        maxLength={120}
        autoFocus
        onChange={(event) => autosave.setValue('title', event.target.value)}
        onBlur={finish}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            finish();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            autosave.revert('title');
            setEditing(false);
          }
        }}
      />
      {error ? (
        <p id="album-title-error" className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function AlbumBody({
  album,
  category,
  categories,
  allAlbums,
  dataUpdatedAt,
}: {
  album: AlbumRow;
  category: CategoryRow | null | undefined;
  categories: readonly CategoryRow[];
  allAlbums: readonly AlbumRow[];
  dataUpdatedAt: number;
}) {
  const autosave = useAlbumAutosave(album, allAlbums, dataUpdatedAt);
  const actions = useAlbumActions();
  const canMutate = useCanMutate();
  const photos = usePhotos(album.id);
  const [dialog, setDialog] = useState<'hide' | 'move' | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const status = albumStatus(album);

  async function publish() {
    setActionError(null);
    try {
      await actions.publish(album);
    } catch (error) {
      setActionError(error);
    }
  }

  return (
    <div className="page">
      <Breadcrumb
        items={[
          { label: cs.nav.categories, to: '/' },
          ...(category ? [{ label: category.name, to: `/kategorie/${category.id}` }] : []),
          { label: album.title },
        ]}
      />
      <div className="page-header">
        <InlineTitle album={album} autosave={autosave} />
        <div className="header-actions">
          <span className="badge" data-state={status}>
            {status === 'published' ? glossary.published : cs.albums.unpublished}
          </span>
          {album.published ? (
            <button type="button" className="button" disabled={!canMutate} onClick={() => setDialog('hide')}>
              {glossary.hideAlbum}
            </button>
          ) : (
            <button type="button" className="button button-primary" disabled={!canMutate} onClick={() => void publish()}>
              {glossary.publishAlbum}
            </button>
          )}
          <button
            type="button"
            className="button"
            disabled={!canMutate || categories.length < 2}
            onClick={() => setDialog('move')}
          >
            {cs.categoryDetail.moveToCategory}
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
      {album.published ? null : <p className="page-note">{cs.album.draftHint}</p>}
      <SaveStatus autosave={autosave} />
      <AlbumDataPanel album={album} autosave={autosave} />
      <section className="photos-area" aria-labelledby="album-photos-heading">
        <h2 id="album-photos-heading">{cs.album.photosHeading}</h2>
        <div className="dropzone">
          <p>{cs.album.dropZone}</p>
          <button type="button" className="button" disabled>
            {glossary.choosePhotos}
          </button>
        </div>
        {photos.data ? (
          <PhotoGallery album={album} photos={photos.data} categories={categories} albums={allAlbums} />
        ) : null}
      </section>
      {dialog === 'hide' ? <HideAlbumDialog album={album} onClose={() => setDialog(null)} /> : null}
      {dialog === 'move' ? (
        <MoveAlbumDialog album={album} categories={categories} albums={allAlbums} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

export function AlbumScreen() {
  const { id = '' } = useParams();
  const album = useAlbum(id);
  const category = useCategory(album.data?.category_id ?? '');
  const categories = useCategories();
  const allAlbums = useAlbums();
  useDocumentTitle(album.data?.title ?? cs.routes.album.title);

  if (album.isError) {
    return (
      <div className="page">
        <h1>{cs.routes.album.title}</h1>
        <LoadFailure error={album.error} message={cs.album.loadFailed} onRetry={() => void album.refetch()} />
      </div>
    );
  }
  if (!album.data) {
    return (
      <div className="page">
        <h1>{cs.routes.album.title}</h1>
        {album.isSuccess ? (
          <>
            <p className="page-note">{cs.album.notFound}</p>
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
  return (
    <AlbumBody
      key={album.data.id}
      album={album.data}
      category={category.data}
      categories={categories.data ?? []}
      allAlbums={allAlbums.data ?? []}
      dataUpdatedAt={album.dataUpdatedAt}
    />
  );
}
