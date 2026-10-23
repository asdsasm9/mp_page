/**
 * "Hlavní fotka kategorie" on the category screen (WP-11, T-272). States: automatic (nothing chosen), chosen (preview,
 * "Změnit", "Zrušit výběr"), picker open, empty category (no photos: the button is disabled with a hint), the notice that
 * the choice was cleared because the photo left the category, and the warning that the chosen photo is in an
 * unpublished album (the public site then keeps using the automatic photo).
 */
import type { AlbumRow, CategoryRow, PhotoRow } from '@mp/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { CoverThumb } from '../components/CoverThumb';
import { Notice } from '../components/Notice';
import { StaleNotice } from '../components/StaleNotice';
import { useToast } from '../components/Toast';
import { takeCategoryCoverCleared } from '../data/categoryCoverNotice';
import { useUpdateCategory } from '../data/catalog';
import { expectUpdatedAt, isStale } from '../data/concurrency';
import { useCanMutate } from '../data/health';
import { photoWebpUrl } from '../data/images';
import { cs } from '../i18n/cs';
import { fill } from '../i18n/format';
import { errorMessage } from '../i18n/messages';
import { useImageBase } from '../ports-context';
import { CategoryCoverPicker } from './CategoryCoverPicker';

const t = cs.categoryCover;

interface Props {
  category: CategoryRow;
  /** Albums of this category in display order (loaded). */
  albums: readonly AlbumRow[];
  /** Photos per album id; `undefined` while that album's photos are loading. */
  photos: ReadonlyMap<string, PhotoRow[] | undefined>;
}

export function CategoryCoverBlock({ category, albums, photos }: Props) {
  const headingId = useId();
  const imgBase = useImageBase();
  const toast = useToast();
  const canMutate = useCanMutate();
  const update = useUpdateCategory();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [clearedNotice, setClearedNotice] = useState(() => takeCategoryCoverCleared(category.id));
  const ownClear = useRef(false);
  const lastCover = useRef(category.cover_photo_id);

  // The cover went from a photo to nothing without this screen asking for it: the photo left the category.
  useEffect(() => {
    const before = lastCover.current;
    lastCover.current = category.cover_photo_id;
    if (category.cover_photo_id !== null) setClearedNotice(false);
    else if (before !== null) {
      if (ownClear.current) ownClear.current = false;
      else setClearedNotice(true);
    }
  }, [category.cover_photo_id]);

  const withPhotos = albums.filter((a) => (photos.get(a.id)?.length ?? 0) > 0);
  const loaded = albums.every((a) => photos.get(a.id) !== undefined);
  const empty = loaded && withPhotos.length === 0;

  const coverId = category.cover_photo_id;
  const coverAlbum = coverId === null ? undefined : albums.find((a) => photos.get(a.id)?.some((row) => row.id === coverId));
  const previewSrc = coverId !== null && coverAlbum ? photoWebpUrl(imgBase, coverId) : null;

  async function clear() {
    setFailure(null);
    ownClear.current = true;
    try {
      await update.mutateAsync({ id: category.id, patch: { cover_photo_id: null }, options: expectUpdatedAt(category) });
      toast.show(t.unset);
    } catch (error) {
      ownClear.current = false;
      setFailure(error);
    }
  }

  return (
    <section className="category-cover" aria-labelledby={headingId}>
      <CoverThumb src={previewSrc} />
      <div className="category-cover-info">
        <h2 id={headingId}>{t.heading}</h2>
        {coverId === null ? (
          <>
            <p className="category-cover-value">{t.auto}</p>
            <p className="page-note">{empty ? t.emptyHint : loaded ? t.autoHint : t.loadingPhotos}</p>
          </>
        ) : (
          <p className="category-cover-value">
            {coverAlbum ? fill(t.fromAlbum, { album: coverAlbum.title }) : t.previewAlt}
          </p>
        )}
      </div>
      <div className="category-cover-actions">
        <button
          type="button"
          className="button"
          aria-describedby={headingId}
          disabled={!canMutate || !loaded || empty}
          onClick={() => setOpen(true)}
        >
          {coverId === null ? t.choose : t.change}
        </button>
        {coverId === null ? null : (
          <button
            type="button"
            className="button"
            aria-describedby={headingId}
            disabled={!canMutate || update.isPending}
            onClick={() => void clear()}
          >
            {update.isPending ? t.clearing : t.clear}
          </button>
        )}
      </div>
      {clearedNotice || coverAlbum?.published === false || failure !== null ? (
        <div className="category-cover-notices">
          {clearedNotice ? (
            <div className="notice" role="status">
              <p>{t.cleared}</p>
              <button type="button" className="button" onClick={() => setClearedNotice(false)}>
                {t.dismiss}
              </button>
            </div>
          ) : null}
          {coverAlbum && !coverAlbum.published ? <Notice variant="info">{t.unpublishedAlbum}</Notice> : null}
          {failure === null ? null : isStale(failure) ? (
            <StaleNotice entity="category" onReload={() => setFailure(null)} />
          ) : (
            <Notice>{errorMessage(failure)}</Notice>
          )}
        </div>
      ) : null}
      {open ? (
        <CategoryCoverPicker
          category={category}
          albums={withPhotos}
          initialAlbumId={coverAlbum?.id ?? null}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}
