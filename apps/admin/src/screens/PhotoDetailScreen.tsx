/** Photo detail (`/alba/:id/foto/:photoId`, ADMIN-UX 3.4): 1600 px preview, alt text and caption, previous/next. */
import type { AlbumRow, PhotoRow } from '@mp/shared';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Breadcrumb } from '../components/Breadcrumb';
import { Field } from '../components/Field';
import { LoadFailure } from '../components/LoadFailure';
import { useDocumentTitle } from '../components/Page';
import { StaleNotice } from '../components/StaleNotice';
import { useToast } from '../components/Toast';
import { captionProblem, checkAlt } from '../data/altText';
import { useAlbum, useCategory, usePhotos, useUpdatePhoto } from '../data/catalog';
import { expectUpdatedAt, isStale } from '../data/concurrency';
import { useCanMutate } from '../data/health';
import { photoWebpUrl } from '../data/images';
import { sortedRows } from '../data/order';
import { usePhotoActions } from '../data/photoActions';
import { cs, glossary } from '../i18n/cs';
import { fill } from '../i18n/format';
import { errorMessage } from '../i18n/messages';
import { useImageBase } from '../ports-context';

const PREVIEW_PX = 1600;
const orNull = (text: string): string | null => (text.trim() === '' ? null : text.trim());

/** Width and height attributes of the preview: 1600 px wide at the photo's ratio (never above the original). */
function previewSize(photo: Pick<PhotoRow, 'width' | 'height'>): { width: number; height: number } {
  const width = Math.min(PREVIEW_PX, photo.width > 0 ? photo.width : PREVIEW_PX);
  const ratio = photo.width > 0 && photo.height > 0 ? photo.height / photo.width : 1;
  return { width, height: Math.max(1, Math.round(width * ratio)) };
}

/** Set by the form: saves an edited draft; resolves true when it is safe to leave the photo (saved or unchanged). */
type Flush = { current: (() => Promise<boolean>) | null };

function TextForm({ photo, flushRef }: { photo: PhotoRow; flushRef: Flush }) {
  const update = useUpdatePhoto();
  const canMutate = useCanMutate();
  const [alt, setAlt] = useState(photo.alt ?? '');
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [altProblems, setAltProblems] = useState<string[]>([]);
  const [captionError, setCaptionError] = useState<string | undefined>();
  const [failure, setFailure] = useState<unknown>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [blocked, setBlocked] = useState(false);
  const altRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const captionRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const latest = useRef(photo);
  latest.current = photo;

  const check = checkAlt(alt);

  /** Validates and saves; true when saved. */
  async function save(): Promise<boolean> {
    setFailure(null);
    const problems = checkAlt(alt).problems;
    const captionIssue = captionProblem(caption);
    setAltProblems(problems);
    setCaptionError(captionIssue);
    if (problems.length > 0) {
      altRef.current?.focus();
      return false;
    }
    if (captionIssue) {
      captionRef.current?.focus();
      return false;
    }
    setState('saving');
    try {
      // Only the two text columns are sent.
      await update.mutateAsync({
        id: photo.id,
        patch: { alt: orNull(alt), caption: orNull(caption) },
        options: expectUpdatedAt(latest.current),
      });
      setState('saved');
      return true;
    } catch (error) {
      setFailure(error);
      setState('idle');
      return false;
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === 'saving') return;
    setBlocked(false);
    await save();
  }

  const dirty = orNull(alt) !== orNull(latest.current.alt ?? '') || orNull(caption) !== orNull(latest.current.caption ?? '');
  flushRef.current = async () => {
    if (state === 'saving') return false;
    if (!dirty) return true;
    const ok = await save();
    setBlocked(!ok);
    return ok;
  };

  const altErrors = altProblems.length > 0 ? altProblems.join(' ') : undefined;
  return (
    <form className="form" noValidate onSubmit={onSubmit} aria-busy={state === 'saving'}>
      <Field
        label={glossary.altText}
        multiline
        value={alt}
        onChange={(v) => {
          setAlt(v);
          setBlocked(false);
          setAltProblems([]);
          setState('idle');
        }}
        error={altErrors}
        hintId="photo-alt-hint"
        hint={
          <>
            <p>{cs.photos.detail.altHint}</p>
            {check.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </>
        }
        onElement={(el) => {
          altRef.current = el;
        }}
      />
      <Field
        label={glossary.caption}
        multiline
        value={caption}
        onChange={(v) => {
          setCaption(v);
          setCaptionError(undefined);
          setState('idle');
        }}
        error={captionError}
        onElement={(el) => {
          captionRef.current = el;
        }}
      />
      {blocked ? (
        <p className="notice notice-error" role="alert">
          {cs.photos.detail.unsavedBlocked}
        </p>
      ) : null}
      {failure === null ? null : isStale(failure) ? (
        <StaleNotice entity="photo" onReload={() => setFailure(null)} />
      ) : (
        <div className="notice notice-error" role="alert">
          <p>{errorMessage(failure)}</p>
        </div>
      )}
      <div className="dialog-actions">
        <button type="submit" className="button button-primary" disabled={!canMutate || state === 'saving'}>
          {state === 'saving' ? cs.photos.detail.saving : glossary.save}
        </button>
        <p className="save-status" role="status">
          {state === 'saved' ? glossary.saved : ''}
        </p>
      </div>
    </form>
  );
}

function PhotoBody({ album, photos, photo }: { album: AlbumRow; photos: readonly PhotoRow[]; photo: PhotoRow }) {
  const imgBase = useImageBase();
  const navigate = useNavigate();
  const toast = useToast();
  const canMutate = useCanMutate();
  const actions = usePhotoActions();
  const category = useCategory(album.category_id);
  const [coverError, setCoverError] = useState<unknown>(null);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const lastNav = useRef<'prev' | 'next' | null>(null);
  const flushRef: Flush = useRef(null);

  const ordered = sortedRows(photos);
  const index = ordered.findIndex((p) => p.id === photo.id);
  const previous = index > 0 ? ordered[index - 1] : undefined;
  const next = index >= 0 ? ordered[index + 1] : undefined;
  const title = fill(cs.photos.detail.title, { n: index + 1, total: ordered.length });
  useDocumentTitle(title);

  // A button that became disabled (first or last photo) cannot keep focus: hand it to the other button.
  useEffect(() => {
    if (lastNav.current === 'next' && !next) prevRef.current?.focus();
    else if (lastNav.current === 'prev' && !previous) nextRef.current?.focus();
    lastNav.current = null;
  }, [photo.id, next, previous]);

  const src = photoWebpUrl(imgBase, photo.id, PREVIEW_PX);
  const size = previewSize(photo);
  const go = async (target: PhotoRow | undefined, direction: 'prev' | 'next') => {
    if (!target) return;
    // An edited draft is saved first; if it is invalid or the save fails, stay here with the message shown.
    if (flushRef.current && !(await flushRef.current())) return;
    lastNav.current = direction;
    navigate(`/alba/${album.id}/foto/${target.id}`, { state: { keepFocus: true } });
  };

  async function setCover() {
    setCoverError(null);
    try {
      await actions.setCover(album, photo.id);
      toast.show(cs.photos.coverSet);
    } catch (error) {
      setCoverError(error);
    }
  }

  return (
    <div className="page">
      <Breadcrumb
        items={[
          { label: cs.nav.categories, to: '/' },
          ...(category.data ? [{ label: category.data.name, to: `/kategorie/${category.data.id}` }] : []),
          { label: album.title, to: `/alba/${album.id}` },
          { label: fill(cs.photos.tileName, { n: index + 1 }) },
        ]}
      />
      <div className="page-header">
        <h1>{title}</h1>
        <div className="header-actions">
          {album.cover_photo_id === photo.id ? (
            <span className="badge">{cs.photos.cover}</span>
          ) : (
            <button type="button" className="button" disabled={!canMutate} onClick={() => void setCover()}>
              {glossary.setAsCover}
            </button>
          )}
        </div>
      </div>
      {coverError === null ? null : isStale(coverError) ? (
        <StaleNotice entity="album" onReload={() => setCoverError(null)} />
      ) : (
        <p className="notice notice-error" role="alert">
          {errorMessage(coverError)}
        </p>
      )}
      <div className="photo-detail">
        <div className="photo-preview" style={photo.dominant_color ? { backgroundColor: photo.dominant_color } : undefined}>
          {src ? (
            <img
              src={src}
              width={size.width}
              height={size.height}
              alt={photo.alt?.trim() ? photo.alt.trim() : fill(cs.photos.tileName, { n: index + 1 })}
              decoding="async"
            />
          ) : null}
        </div>
        <div className="photo-side">
          <TextForm key={photo.id} photo={photo} flushRef={flushRef} />
          <nav className="photo-nav" aria-label={cs.photos.detail.nav}>
            <button type="button" ref={prevRef} className="button" disabled={!previous} onClick={() => void go(previous, 'prev')}>
              {cs.photos.detail.previous}
            </button>
            <button type="button" ref={nextRef} className="button" disabled={!next} onClick={() => void go(next, 'next')}>
              {cs.photos.detail.next}
            </button>
          </nav>
          <p>
            <Link to={`/alba/${album.id}`}>{cs.photos.detail.backToAlbum}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

/** Page frame for the loading, failure and not-found states (the loaded state sets its own title). */
function Frame({ children }: { children: ReactNode }) {
  useDocumentTitle(cs.routes.photo.title);
  return <div className="page">{children}</div>;
}

export function PhotoDetailScreen() {
  const { id = '', photoId = '' } = useParams();
  const album = useAlbum(id);
  const photos = usePhotos(id);

  if (album.isError || photos.isError) {
    return (
      <Frame>
        <h1>{cs.routes.photo.title}</h1>
        <LoadFailure
          error={album.error ?? photos.error}
          message={cs.photos.detail.loadFailed}
          onRetry={() => {
            void album.refetch();
            void photos.refetch();
          }}
        />
      </Frame>
    );
  }
  const photo = photos.data?.find((p) => p.id === photoId);
  if (!album.data || !photos.data || !photo) {
    const done = album.isSuccess && photos.isSuccess;
    return (
      <Frame>
        <h1>{cs.routes.photo.title}</h1>
        {done ? (
          <>
            <p className="page-note">{cs.photos.detail.notFound}</p>
            <p>
              <Link to={`/alba/${id}`}>{cs.photos.detail.backToAlbum}</Link>
            </p>
          </>
        ) : (
          <p role="status" aria-busy="true" className="page-note">
            {cs.data.loading}
          </p>
        )}
      </Frame>
    );
  }
  return <PhotoBody album={album.data} photos={photos.data} photo={photo} />;
}
