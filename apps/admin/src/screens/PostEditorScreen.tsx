/**
 * Instagram post editor (`/instagram/novy` and `/instagram/:id`, WP-14): photos (1 to 10, ordered), caption and
 * hashtags with live counters, optional planned date, an explicit "Uložit" (no autosave). Status is one segmented
 * control: Koncept, Naplánováno, Zveřejněno. Zveřejněno asks for a date (also for old posts) and needs a saved,
 * unchanged post; leaving it asks a short confirm and unmarks (T-353). Share, copy, download and delete are icons in
 * the sticky top bar (T-352). A post without photos (all deleted from the albums) is a draft with a notice; planning
 * or marking it is refused.
 */
import {
  IG_CAPTION_MAX,
  IG_HASHTAGS_COUNT_MAX,
  IG_HASHTAGS_MAX,
  IG_PHOTOS_MAX,
  captionLength,
  countHashtags,
  effectiveStatus,
  postedText,
  type IgPost,
} from '@mp/shared';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Breadcrumb } from '../components/Breadcrumb';
import { ActionButton } from '../components/IconButton';
import { Field } from '../components/Field';
import { LoadFailure } from '../components/LoadFailure';
import { Notice } from '../components/Notice';
import { useDocumentTitle } from '../components/Page';
import { PageLoading } from '../components/PageLoading';
import { PostPhotoStrip } from '../components/PostPhotoStrip';
import { SharePanel } from '../components/SharePanel';
import { StaleNotice } from '../components/StaleNotice';
import { useToast } from '../components/Toast';
import { expectUpdatedAt, isStale } from '../data/concurrency';
import { useCanMutate } from '../data/health';
import {
  useCreateIgPost,
  useDeleteIgPost,
  useIgPosts,
  useMarkIgPostPosted,
  useSetIgPostPhotos,
  useUnmarkIgPostPosted,
  useUpdateIgPost,
} from '../data/planner';
import { cs } from '../i18n/cs';
import { fill, formatPragueDateTime } from '../i18n/format';
import { errorMessage } from '../i18n/messages';
import { useImageBase } from '../ports-context';
import { DeletePostDialog, MarkPostedDialog, UnmarkPostedDialog } from './PostDialogs';
import { PostPhotoPicker } from './PostPhotoPicker';

const t = cs.instagram.editor;

interface Draft {
  caption: string;
  hashtags: string;
  plannedOn: string;
  status: 'draft' | 'planned';
  photoIds: string[];
}

function draftOf(post: IgPost | null): Draft {
  if (!post) return { caption: '', hashtags: '', plannedOn: '', status: 'draft', photoIds: [] };
  const status = effectiveStatus(post);
  return {
    caption: post.caption,
    hashtags: post.hashtags,
    plannedOn: post.planned_on ?? '',
    status: status === 'planned' ? 'planned' : 'draft',
    photoIds: [...post.photos].sort((a, b) => a.sort - b.sort).map((p) => p.photo_id),
  };
}

type StatusChoice = 'draft' | 'planned' | 'posted';
const STATUS_LABEL: Record<StatusChoice, string> = {
  draft: cs.instagram.statusDraft,
  planned: cs.instagram.statusPlanned,
  posted: cs.instagram.statusPosted,
};

const sameList =(a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

function postedDay(post: IgPost): string {
  return formatPragueDateTime(post.posted_at ?? '').replace(/\s\d{2}:\d{2}$/, '');
}

function PostEditor({ post, title, onReload }: { post: IgPost | null; title: string; onReload: () => void }) {
  const choosePhotosRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const toast = useToast();
  const imgBase = useImageBase();
  const canMutate = useCanMutate();
  const captionHintId = useId();
  const hashtagsHintId = useId();
  const create = useCreateIgPost();
  const update = useUpdateIgPost();
  const setPhotos = useSetIgPostPhotos();
  const markPosted = useMarkIgPostPosted();
  const unmark = useUnmarkIgPostPosted();
  const remove = useDeleteIgPost();

  const saved = draftOf(post);
  const [draft, setDraft] = useState<Draft>(saved);
  const [dialog, setDialog] = useState<'photos' | 'mark' | 'unmark' | 'delete' | null>(null);
  const [unmarkTarget, setUnmarkTarget] = useState<'draft' | 'planned'>('planned');
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const statusHintId = useId();
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const isPosted = post?.status === 'posted';
  const dirty =
    draft.caption !== saved.caption ||
    draft.hashtags !== saved.hashtags ||
    draft.plannedOn !== saved.plannedOn ||
    // A posted post has no draft or planned choice; its status is changed only through the confirmed unmark.
    (!isPosted && draft.status !== saved.status) ||
    !sameList(draft.photoIds, saved.photoIds);

  const captionLen = captionLength(draft.caption);
  const hashtagsLen = captionLength(draft.hashtags);
  const combinedLen = captionLength(postedText(draft));
  const tagCount = countHashtags(draft.hashtags);
  const captionWarning =
    IG_CAPTION_MAX < captionLen ? t.captionTooLong : IG_CAPTION_MAX < combinedLen ? t.combinedTooLong : null;
  const hashtagWarning =
    IG_HASHTAGS_MAX < hashtagsLen ? t.hashtagsTooLong : IG_HASHTAGS_COUNT_MAX < tagCount ? t.hashtagsTooMany : null;

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((now) => ({ ...now, [key]: value }));
    setProblems([]);
  }

  function validate(): string[] {
    const found: string[] = [];
    const mustHavePhoto = post === null || post.photos.length > 0 || draft.status === 'planned';
    if (draft.photoIds.length === 0 && mustHavePhoto) found.push(t.needPhoto);
    if (IG_CAPTION_MAX < captionLen) found.push(t.captionTooLong);
    if (IG_HASHTAGS_MAX < hashtagsLen) found.push(t.hashtagsTooLong);
    return found;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || !canMutate) return;
    const found = validate();
    setProblems(found);
    if (found.length > 0) return;
    setSaving(true);
    setFailure(null);
    const fields = { caption: draft.caption, hashtags: draft.hashtags, planned_on: draft.plannedOn || null };
    try {
      if (post === null) {
        const created = await create.mutateAsync({ ...fields, status: draft.status, photoIds: draft.photoIds });
        toast.show(t.saved);
        navigate(`/instagram/${created.id}`, { replace: true });
        return;
      }
      const patch = { ...fields, ...(isPosted || draft.status === post.status ? {} : { status: draft.status }) };
      const photosChanged = !sameList(draft.photoIds, saved.photoIds) && draft.photoIds.length > 0;
      if (photosChanged && post.photos.length === 0) {
        // A post without photos cannot become planned before it has some; the RPC also touches updated_at.
        await setPhotos.mutateAsync({ id: post.id, photoIds: draft.photoIds });
        await update.mutateAsync({ id: post.id, patch });
      } else {
        await update.mutateAsync({ id: post.id, patch, options: expectUpdatedAt(post) });
        if (photosChanged) await setPhotos.mutateAsync({ id: post.id, photoIds: draft.photoIds });
      }
      toast.show(t.saved);
    } catch (error) {
      setFailure(error);
    } finally {
      setSaving(false);
    }
  }

  async function mark(postedAt: string) {
    if (!post) return;
    await markPosted.mutateAsync({ id: post.id, postedAt, options: expectUpdatedAt(post) });
    toast.show(t.markedToast);
    setDialog(null);
  }

  /** Koncept or Naplánováno on a posted post: back to planned (last in the block), then to draft when asked. */
  async function undo(target: 'draft' | 'planned') {
    if (!post) return;
    setFailure(null);
    try {
      const back = await unmark.mutateAsync({ id: post.id, options: expectUpdatedAt(post) });
      if (target === 'draft') await update.mutateAsync({ id: post.id, patch: { status: 'draft' }, options: expectUpdatedAt(back) });
      setDraft((now) => ({ ...now, status: target }));
      toast.show(t.unmarkedToast);
    } catch (error) {
      // A conflict or a failed second call is shown in the editor, where "Načíst znovu" lives.
      setFailure(error);
    }
    setDialog(null);
  }

  function chooseStatus(status: StatusChoice) {
    if (status === 'posted') {
      if (!isPosted) setDialog('mark');
    } else if (isPosted) {
      setUnmarkTarget(status);
      setDialog('unmark');
    } else {
      set('status', status);
    }
  }

  const noPhotos = post !== null && post.photos.length === 0;
  const postedLocked = !isPosted && (post === null || dirty || noPhotos);
  const postedHint = isPosted ? null : post === null ? t.postedAfterSave : dirty ? t.saveFirst : noPhotos ? t.needPhoto : null;
  const statusDisabled = (status: StatusChoice) =>
    status === 'posted' ? !isPosted && (!canMutate || postedLocked) : isPosted && (!canMutate || (status === 'planned' && noPhotos));

  async function erase() {
    if (!post) return;
    await remove.mutateAsync(post.id);
    toast.show(t.deletedToast);
    navigate('/instagram');
  }

  return (
    <div className="page post-editor">
      <Breadcrumb items={[{ label: cs.routes.instagram.title, to: '/instagram' }, { label: title }]} />
      <h1>{title}</h1>
      {post === null ? null : (
        <div className="post-bar" role="group" aria-label={t.actionsLabel}>
          <div ref={setSlot} className="post-bar-slot" />
          <ActionButton icon="trash" label={t.deleteButton} variant="danger" disabled={!canMutate} onClick={() => setDialog('delete')} />
        </div>
      )}
      {post !== null && post.photos.length === 0 && !isPosted ? (
        <Notice variant="info" as="div">
          <p>{t.noPhotosNotice}</p>
          <p>{t.photoRemoved}</p>
        </Notice>
      ) : null}
      {failure === null ? null : isStale(failure) ? (
        <StaleNotice entity="post" onReload={onReload} />
      ) : (
        <Notice>{errorMessage(failure)}</Notice>
      )}

      {post === null || post.photos.length === 0 ? null : (
        <SharePanel key={post.photos.map((p) => `${p.sort}:${p.photo_id}`).join(',')} post={post} dirty={dirty} actionsSlot={slot} />
      )}

      <form className="form post-form" noValidate onSubmit={(event) => void save(event)}>
        <div className="post-photos">
          <div className="post-photos-head">
            <p className="page-note" role="status" aria-live="polite">
              {fill(t.selectedCount, { n: draft.photoIds.length, max: IG_PHOTOS_MAX })}
            </p>
            <button ref={choosePhotosRef} type="button" className="button" disabled={!canMutate} onClick={() => setDialog('photos')}>
              {draft.photoIds.length === 0 ? t.choosePhotos : t.changePhotos}
            </button>
          </div>
          {draft.photoIds.length === 0 && post === null ? <p className="page-note">{t.needPhoto}</p> : null}
          {draft.photoIds.length > 0 ? (
            <>
              <p className="field-hint">{t.stripHint}</p>
              <PostPhotoStrip
                photoIds={draft.photoIds}
                imgBase={imgBase}
                onChange={(ids) => set('photoIds', ids)}
                onLastRemoved={() => choosePhotosRef.current?.focus()}
              />
            </>
          ) : null}
        </div>

        <div className="post-fields">
        <Field
          label={t.captionLabel}
          value={draft.caption}
          onChange={(value) => set('caption', value)}
          multiline
          hintId={captionHintId}
          hint={
            <span role="status" aria-live="polite">
              {fill(t.captionCount, { n: captionLen, max: IG_CAPTION_MAX })}
              {captionWarning === null ? null : <strong className="field-error"> {captionWarning}</strong>}
            </span>
          }
        />
        <Field
          label={t.hashtagsLabel}
          value={draft.hashtags}
          onChange={(value) => set('hashtags', value)}
          multiline
          autoCapitalize="none"
          hintId={hashtagsHintId}
          hint={
            <span role="status" aria-live="polite">
              {fill(t.hashtagsCount, { n: tagCount, max: IG_HASHTAGS_COUNT_MAX })}
              {hashtagWarning === null ? null : <strong className="field-error"> {hashtagWarning}</strong>}
            </span>
          }
        />
        <div className="post-meta">
          <fieldset className="post-status" aria-describedby={postedHint === null ? undefined : statusHintId}>
            <legend>{t.status}</legend>
            <div className="segmented">
              {(['draft', 'planned', 'posted'] as const).map((status) => (
                <label key={status} className="segmented-option">
                  <input
                    type="radio"
                    name="post-status"
                    className="visually-hidden"
                    value={status}
                    checked={(isPosted ? 'posted' : draft.status) === status}
                    disabled={statusDisabled(status)}
                    onChange={() => chooseStatus(status)}
                  />
                  <span>{STATUS_LABEL[status]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {isPosted ? null : (
            <Field
              label={t.plannedOn}
              type="date"
              compact
              value={draft.plannedOn}
              onChange={(value) => set('plannedOn', value)}
            />
          )}
        </div>
        {isPosted && post !== null ? <p className="field-hint">{fill(t.postedLine, { date: postedDay(post) })}</p> : null}
        {postedHint === null ? null : (
          <p id={statusHintId} className="field-hint">
            {postedHint}
          </p>
        )}

        {problems.length === 0 ? null : (
          <Notice as="div">
            {problems.map((problem) => (
              <p key={problem}>{problem}</p>
            ))}
          </Notice>
        )}
        <div className="post-actions">
          <button
            type="submit"
            className="button button-primary"
            disabled={!canMutate}
            aria-disabled={saving || undefined}
            aria-busy={saving}
          >
            {saving ? t.saving : t.save}
          </button>
        </div>
        </div>
      </form>

      {dialog === 'photos' ? (
        <PostPhotoPicker
          selected={draft.photoIds}
          onClose={() => setDialog(null)}
          onConfirm={(ids) => {
            set('photoIds', ids);
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === 'mark' ? <MarkPostedDialog onClose={() => setDialog(null)} onConfirm={mark} /> : null}
      {dialog === 'unmark' ? (
        <UnmarkPostedDialog target={unmarkTarget} onClose={() => setDialog(null)} onConfirm={() => undo(unmarkTarget)} />
      ) : null}
      {dialog === 'delete' ? <DeletePostDialog onClose={() => setDialog(null)} onConfirm={erase} /> : null}
    </div>
  );
}

export function PostEditorScreen() {
  const { id } = useParams();
  const posts = useIgPosts();
  const [epoch, setEpoch] = useState(0);
  const post = id === undefined ? null : (posts.data?.find((p) => p.id === id) ?? undefined);
  const title = id === undefined ? cs.instagram.newPost : post ? t.editTitle : cs.routes.instagram.title;
  useDocumentTitle(title);

  if (id === undefined) return <PostEditor post={null} title={title} onReload={() => undefined} />;
  if (posts.isError) {
    return (
      <div className="page">
        <h1>{cs.routes.instagram.title}</h1>
        <LoadFailure error={posts.error} message={t.loadFailed} onRetry={() => void posts.refetch()} />
      </div>
    );
  }
  if (!post) {
    return (
      <div className="page">
        <h1>{cs.routes.instagram.title}</h1>
        {posts.data ? (
          <>
            <p className="page-note">{t.notFound}</p>
            <p>
              <Link to="/instagram">{t.backToPlan}</Link>
            </p>
          </>
        ) : (
          <PageLoading>{cs.data.loading}</PageLoading>
        )}
      </div>
    );
  }
  // "Načíst znovu" after a conflict: the draft is dropped and the editor starts again from the fresh post, so a
  // later save can never overwrite the other device's edit with an old draft.
  const reload = () => void posts.refetch().then(() => setEpoch((n) => n + 1));
  return <PostEditor key={`${post.id}-${epoch}`} post={post} title={title} onReload={reload} />;
}
