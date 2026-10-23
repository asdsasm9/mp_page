/** Categories list (`/`, ADMIN-UX 3.2): counts, visibility, create / rename / hide / delete, reorder. */
import type { CategoryRow } from '@mp/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { IconButton } from '../components/IconButton';
import { LoadFailure } from '../components/LoadFailure';
import { Notice } from '../components/Notice';
import { useDocumentTitle } from '../components/Page';
import { PageLoading } from '../components/PageLoading';
import { SortableList } from '../components/SortableList';
import { StaleNotice } from '../components/StaleNotice';
import { StorageBar } from '../components/StorageBar';
import { catalogKeys, useAlbums, useCategories, usePhotoCounts, useUpdateCategory } from '../data/catalog';
import { expectUpdatedAt, isStale } from '../data/concurrency';
import { useCanMutate } from '../data/health';
import type { SortUpdate } from '../data/order';
import { cs, glossary } from '../i18n/cs';
import { fill, formatCount } from '../i18n/format';
import { errorMessage } from '../i18n/messages';
import { CategoryFormDialog, DeleteCategoryDialog, HideCategoryDialog } from './CategoryDialogs';

type DialogState =
  | { kind: 'create' }
  | { kind: 'edit' | 'hide' | 'delete'; id: string }
  | null;

export function CategoriesScreen() {
  useDocumentTitle(cs.routes.categories.title);
  const categories = useCategories();
  const albums = useAlbums();
  const update = useUpdateCategory();
  const queryClient = useQueryClient();
  const canMutate = useCanMutate();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [focusHeading, setFocusHeading] = useState(false);

  const rows = useMemo(() => categories.data ?? [], [categories.data]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const albumRows = albums.data;
  const albumIds = useMemo(() => (albumRows ?? []).map((a) => a.id), [albumRows]);
  const photoCounts = usePhotoCounts(albumIds);

  useEffect(() => {
    if (!focusHeading) return;
    headingRef.current?.focus();
    setFocusHeading(false);
  }, [focusHeading]);

  /** Albums per category, or undefined while the album list is not available. */
  function albumsOf(category: CategoryRow) {
    return albumRows?.filter((a) => a.category_id === category.id);
  }

  function countsText(category: CategoryRow): string {
    const own = albumsOf(category);
    if (!own) return '';
    const known = own.map((a) => photoCounts.get(a.id));
    const albumText = formatCount(own.length, cs.units.album);
    if (known.some((n) => n === undefined)) return albumText;
    const photos = known.reduce<number>((sum, n) => sum + (n ?? 0), 0);
    return fill(cs.categories.counts, { albums: albumText, photos: formatCount(photos, cs.units.photo) });
  }

  async function reorder(updates: SortUpdate[]) {
    const byId = new Map(rowsRef.current.map((c) => [c.id, c] as const));
    try {
      await Promise.all(
        updates.flatMap((u) => {
          const row = byId.get(u.id);
          return row
            ? [update.mutateAsync({ id: u.id, patch: { sort: u.sort }, options: expectUpdatedAt(row) })]
            : [];
        }),
      );
    } catch (error) {
      // Some of the rows may have been written: show what the database has now.
      await queryClient.invalidateQueries({ queryKey: catalogKeys.categories() });
      throw error;
    }
  }

  async function toggleVisible(category: CategoryRow) {
    setActionError(null);
    try {
      await update.mutateAsync({
        id: category.id,
        patch: { visible: true },
        options: expectUpdatedAt(category),
      });
    } catch (error) {
      setActionError(error);
    }
  }

  const current =
    dialog && dialog.kind !== 'create' ? rows.find((c) => c.id === dialog.id) : undefined;
  const closeDialog = () => setDialog(null);

  let body;
  if (categories.isError) {
    body = (
      <LoadFailure
        error={categories.error}
        message={cs.categories.loadFailed}
        onRetry={() => void categories.refetch()}
      />
    );
  } else if (!categories.data) {
    body = (
      <PageLoading>{cs.data.loading}</PageLoading>
    );
  } else if (rows.length === 0) {
    body = (
      <div className="empty-state">
        <p>{cs.categories.empty}</p>
        <button
          type="button"
          className="button button-primary"
          disabled={!canMutate}
          onClick={() => setDialog({ kind: 'create' })}
        >
          {glossary.newCategory}
        </button>
      </div>
    );
  } else {
    body = (
      <SortableList
        items={rows}
        label={cs.categories.listLabel}
        itemLabel={(c) => c.name}
        onReorder={reorder}
        staleEntity="category"
        renderItem={(c) => (
          <>
            <Link to={`/kategorie/${c.id}`} className="row-title">
              {c.name}
            </Link>
            <span className="badge" data-state={c.visible ? 'visible' : 'hidden'}>
              {c.visible ? glossary.visible : glossary.hiddenCategory}
            </span>
            <span className="row-meta">{countsText(c)}</span>
          </>
        )}
        renderActions={(c) => {
          const known = albumsOf(c) !== undefined;
          return (
            <>
              <IconButton
                icon="edit"
                label={`${cs.categories.edit}: ${c.name}`}
                disabled={!canMutate}
                onClick={() => setDialog({ kind: 'edit', id: c.id })}
              />
              <IconButton
                icon={c.visible ? 'hide' : 'show'}
                label={`${c.visible ? cs.categories.hide : cs.categories.show}: ${c.name}`}
                disabled={!canMutate || !known}
                onClick={() => (c.visible ? setDialog({ kind: 'hide', id: c.id }) : void toggleVisible(c))}
              />
              <IconButton
                icon="trash"
                danger
                label={`${glossary.delete}: ${c.name}`}
                disabled={!canMutate || !known}
                onClick={() => setDialog({ kind: 'delete', id: c.id })}
              />
            </>
          );
        }}
      />
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 ref={headingRef} tabIndex={-1}>
          {cs.routes.categories.title}
        </h1>
        {rows.length > 0 ? (
          <button
            type="button"
            className="button button-primary"
            disabled={!canMutate}
            onClick={() => setDialog({ kind: 'create' })}
          >
            {glossary.newCategory}
          </button>
        ) : null}
      </div>
      <StorageBar variant="large" />
      {actionError === null ? null : isStale(actionError) ? (
        <StaleNotice entity="category" onReload={() => setActionError(null)} />
      ) : (
        <Notice>{errorMessage(actionError)}</Notice>
      )}
      {body}
      {dialog?.kind === 'create' ? (
        <CategoryFormDialog categories={rows} onClose={closeDialog} />
      ) : null}
      {dialog?.kind === 'edit' && current ? (
        <CategoryFormDialog category={current} categories={rows} onClose={closeDialog} />
      ) : null}
      {dialog?.kind === 'hide' && current ? (
        <HideCategoryDialog
          category={current}
          albumCount={albumsOf(current)?.length ?? 0}
          onClose={closeDialog}
        />
      ) : null}
      {dialog?.kind === 'delete' && current ? (
        <DeleteCategoryDialog
          category={current}
          albumCount={albumsOf(current)?.length ?? 0}
          onClose={closeDialog}
          onDeleted={() => setFocusHeading(true)}
        />
      ) : null}
    </div>
  );
}
