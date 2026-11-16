/**
 * Posting by hand from the phone (WP-14 section 6, T-346) for a SAVED post with photos. The 1600 JPEGs are fetched
 * when the panel opens (or by "Připravit fotky") and kept as `File`s, so the tap on "Sdílet do Instagramu" calls
 * `navigator.share({ files })` at once, inside the user activation. Instagram ignores shared text, so the caption is
 * copied separately; "Stáhnout fotky" is the fallback everywhere (also desktop).
 */
import { postedText, type IgPost } from '@mp/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cs } from '../i18n/cs';
import { useImageBase, useShareDeps } from '../ports-context';
import { fetchShareFiles, probeFile } from '../share/shareFiles';
import { ActionButton } from './IconButton';
import { Notice } from './Notice';
import { useToast } from './Toast';

const t = cs.instagram.share;

type Prep = 'idle' | 'preparing' | 'ready';

/** Photo ids of a post in carousel order. */
export function carouselIds(post: Pick<IgPost, 'photos'>): string[] {
  return [...post.photos].sort((a, b) => a.sort - b.sort).map((p) => p.photo_id);
}

/**
 * `actionsSlot`: undefined = the buttons sit inside the panel; an element = they are portalled there (the editor's
 * sticky top bar); null = that element is not mounted yet, so nothing is shown for a moment.
 */
export function SharePanel({ post, dirty, actionsSlot }: { post: IgPost; dirty: boolean; actionsSlot?: HTMLElement | null }) {
  const deps = useShareDeps();
  const imgBase = useImageBase();
  const toast = useToast();
  const textId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const ids = carouselIds(post);
  const idsKey = ids.join(',');
  const text = postedText(post);

  const [canShareFiles, setCanShareFiles] = useState(() => deps.canShare({ files: [probeFile()] }));
  const [files, setFiles] = useState<File[] | null>(null);
  const [prep, setPrep] = useState<Prep>('idle');
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [manualCopy, setManualCopy] = useState(false);
  const preparing = useRef(false);

  async function prepare(): Promise<File[] | null> {
    if (preparing.current) return null;
    preparing.current = true;
    setPrep('preparing');
    setError('');
    setInfo(t.preparing);
    try {
      const made = await fetchShareFiles(deps, imgBase, ids);
      setFiles(made);
      setPrep('ready');
      setInfo(t.ready);
      // Recheck with the real files: some browsers refuse the file types or the count the probe accepted.
      setCanShareFiles(deps.canShare({ files: made }));
      return made;
    } catch {
      setPrep('idle');
      setInfo('');
      setError(t.fetchFailed);
      return null;
    } finally {
      preparing.current = false;
    }
  }

  // The panel is keyed by the saved photo list in the editor, so it prepares once per list.
  const autoPrepare = canShareFiles && ids.length > 0;
  useEffect(() => {
    if (autoPrepare) void prepare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, autoPrepare]);

  useEffect(() => {
    if (manualCopy) textRef.current?.select();
  }, [manualCopy]);

  async function share() {
    if (!files) return;
    setError('');
    setInfo('');
    try {
      await deps.share({ files });
    } catch (failure) {
      const name = failure instanceof Error || failure instanceof DOMException ? failure.name : '';
      if (name === 'AbortError') setInfo(t.cancelled);
      else if (name === 'NotAllowedError') setError(t.notAllowed);
      else setError(t.shareFailed);
    }
  }

  async function copy() {
    setError('');
    try {
      await deps.writeText(text);
      setManualCopy(false);
      toast.show(t.copied);
    } catch {
      setManualCopy(true);
      setError(t.copyFailed);
    }
  }

  async function download() {
    setError('');
    const ready = files ?? (await prepare());
    if (!ready) return;
    for (const file of ready) deps.download(file);
  }

  const actions = (
    <>
      {canShareFiles && prep === 'ready' ? (
        <ActionButton icon="share" label={t.share} variant="primary" onClick={() => void share()} />
      ) : null}
      {canShareFiles && prep === 'idle' ? <ActionButton icon="refresh" label={t.prepare} onClick={() => void prepare()} /> : null}
      <ActionButton icon="copy" label={t.copy} onClick={() => void copy()} />
      <ActionButton icon="download" label={t.download} disabled={prep === 'preparing'} onClick={() => void download()} />
    </>
  );

  return (
    <section className="post-share">
      {ids.length === 0 ? (
        <p className="page-note">{t.noPhotos}</p>
      ) : (
        <>
          {/* The buttons go into the editor's sticky top bar when it hands over a slot; alone they sit here. */}
          {actionsSlot === undefined ? <div className="post-share-actions">{actions}</div> : null}
          {actionsSlot ? createPortal(actions, actionsSlot) : null}
          <p className="field-hint">{t.tip}</p>
          {dirty ? <p className="field-hint">{t.unsaved}</p> : null}
          <p className="page-note" role="status" aria-live="polite">
            {info}
          </p>
          {error === '' ? null : <Notice>{error}</Notice>}
          {manualCopy ? (
            <div className="field">
              <label htmlFor={textId}>{t.captionLabel}</label>
              <textarea id={textId} ref={textRef} readOnly rows={6} value={text} onFocus={(e) => e.currentTarget.select()} />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
