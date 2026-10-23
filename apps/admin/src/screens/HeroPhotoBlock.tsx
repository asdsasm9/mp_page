/**
 * "Hlavní fotka úvodní stránky" (WP-12 step 28, T-286). States: automatic (nothing chosen), chosen (name of the album,
 * "Změnit", "Zrušit výběr", two crops: how the hero looks on a desktop and on a phone), picker open, no photos at all
 * (the button is disabled with a hint), the notice that the choice was cleared because the photo was deleted, the
 * warning "Nízké rozlišení pro velkou fotku", and the warnings that the chosen photo is in an unpublished album or a
 * hidden category (the public site then keeps the default photo).
 */
import { HERO_MIN_MASTER_WIDTH, type AlbumRow, type CategoryRow, type PhotoRow } from '@mp/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { Notice } from '../components/Notice';
import { useToast } from '../components/Toast';
import { useUpdateSiteSettings } from '../data/catalog';
import { useCanMutate } from '../data/health';
import { takeHeroPhotoCleared } from '../data/heroPhotoNotice';
import { photoWebpUrl } from '../data/images';
import { isLowForHero } from '../data/photoQuality';
import { cs } from '../i18n/cs';
import { fill } from '../i18n/format';
import { errorMessage } from '../i18n/messages';
import { useImageBase } from '../ports-context';
import { HeroPhotoPicker } from './HeroPhotoPicker';

const t = cs.heroPhoto;

interface Props {
  heroPhotoId: string | null;
  categories: readonly CategoryRow[];
  /** All albums in display order (category sort, then album sort). */
  albums: readonly AlbumRow[];
  /** Photos per album id; `undefined` while that album's photos are loading. */
  photos: ReadonlyMap<string, PhotoRow[] | undefined>;
}

export function HeroPhotoBlock({ heroPhotoId, categories, albums, photos }: Props) {
  const headingId = useId();
  const previewId = useId();
  const imgBase = useImageBase();
  const toast = useToast();
  const canMutate = useCanMutate();
  const update = useUpdateSiteSettings();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [clearedNotice, setClearedNotice] = useState(() => takeHeroPhotoCleared());
  const ownClear = useRef(false);
  const last = useRef(heroPhotoId);

  // The choice went from a photo to nothing without this screen asking for it: the photo was deleted.
  useEffect(() => {
    const before = last.current;
    last.current = heroPhotoId;
    if (heroPhotoId !== null) setClearedNotice(false);
    else if (before !== null) {
      if (ownClear.current) ownClear.current = false;
      else setClearedNotice(true);
    }
  }, [heroPhotoId]);

  const categoryName = new Map(categories.map((c) => [c.id, c.name] as const));
  const withPhotos = albums.filter((a) => (photos.get(a.id)?.length ?? 0) > 0);
  const loaded = albums.every((a) => photos.get(a.id) !== undefined);
  const empty = loaded && withPhotos.length === 0;

  const heroAlbum =
    heroPhotoId === null ? undefined : albums.find((a) => photos.get(a.id)?.some((row) => row.id === heroPhotoId));
  const heroPhoto = heroAlbum === undefined ? undefined : photos.get(heroAlbum.id)?.find((row) => row.id === heroPhotoId);
  const heroCategory = heroAlbum === undefined ? undefined : categories.find((c) => c.id === heroAlbum.category_id);
  const previewSrc = heroPhotoId !== null && heroAlbum ? photoWebpUrl(imgBase, heroPhotoId, 960) : null;

  async function clear() {
    setFailure(null);
    ownClear.current = true;
    try {
      await update.mutateAsync({ hero_photo_id: null });
      toast.show(t.unset);
    } catch (error) {
      ownClear.current = false;
      setFailure(error);
    }
  }

  const low = heroPhoto !== undefined && isLowForHero(heroPhoto);
  const notices = clearedNotice || low || heroAlbum?.published === false || heroCategory?.visible === false || failure !== null;

  return (
    <section className="category-cover hero-photo" aria-labelledby={headingId}>
      <div className="category-cover-info">
        <h2 id={headingId}>{t.heading}</h2>
        <p className="page-note">{t.intro}</p>
        {heroPhotoId === null || !heroAlbum ? (
          <>
            <p className="category-cover-value">{t.auto}</p>
            <p className="page-note">{empty ? t.emptyHint : loaded ? t.autoHint : t.loadingPhotos}</p>
          </>
        ) : (
          <p className="category-cover-value">
            {fill(t.fromAlbum, { album: `${categoryName.get(heroAlbum.category_id) ?? ''} · ${heroAlbum.title}` })}
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
          {heroPhotoId === null ? t.choose : t.change}
        </button>
        {heroPhotoId === null ? null : (
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
      {previewSrc === null ? null : (
        <div className="hero-preview" role="group" aria-labelledby={previewId}>
          <h3 id={previewId}>{t.previewHeading}</h3>
          <div className="hero-preview-frames">
            <figure className="hero-preview-frame hero-preview-desktop">
              <img src={previewSrc} alt="" loading="lazy" decoding="async" />
              <figcaption>{t.previewDesktop}</figcaption>
            </figure>
            <figure className="hero-preview-frame hero-preview-phone">
              <img src={previewSrc} alt="" loading="lazy" decoding="async" />
              <figcaption>{t.previewPhone}</figcaption>
            </figure>
          </div>
        </div>
      )}
      {notices ? (
        <div className="category-cover-notices">
          {clearedNotice ? (
            <div className="notice" role="status">
              <p>{t.cleared}</p>
              <button type="button" className="button" onClick={() => setClearedNotice(false)}>
                {t.dismiss}
              </button>
            </div>
          ) : null}
          {low ? (
            <Notice variant="info" as="div">
              <p>
                <strong>{t.lowResolution}</strong>
              </p>
              <p>{fill(t.lowResolutionHint, { min: HERO_MIN_MASTER_WIDTH })}</p>
            </Notice>
          ) : null}
          {heroAlbum && !heroAlbum.published ? <Notice variant="info">{t.unpublishedAlbum}</Notice> : null}
          {heroCategory && !heroCategory.visible ? <Notice variant="info">{t.hiddenCategory}</Notice> : null}
          {failure === null ? null : <Notice>{errorMessage(failure)}</Notice>}
        </div>
      ) : null}
      {open ? (
        <HeroPhotoPicker
          albums={withPhotos.map((album) => ({
            album,
            label: `${categoryName.get(album.category_id) ?? ''} · ${album.title}`,
          }))}
          initialAlbumId={heroAlbum?.id ?? null}
          currentPhotoId={heroPhotoId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}
