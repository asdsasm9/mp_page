/**
 * "Upravit profil" dialog of the Instagram preview (WP-15 step 9, T-364): the typed values of the profile (username,
 * name, bio with line breaks and a counter, link, followers, following) and the avatar photo: "Nahrát fotku" picks a file,
 * which is centre-cropped to a 480 px WebP in the browser, shown as a round preview and uploaded on its own right away
 * (WP-16; "Uložit" waits for it, "Odebrat fotku" clears). Explicit "Uložit", no
 * autosave; the values are checked with the shared IgProfileRowSchema (the same limits as the table) and shown as Czech
 * messages next to the field. The save carries the updated_at the form was based on: when another device changed the
 * profile meanwhile the existing stale notice appears, and "Načíst znovu" loads the row again and starts the form
 * over from it (like the post editor), so an old draft can never overwrite the newer values. Nothing here talks to
 * Instagram; the link stays text.
 */
import { IG_BIO_MAX, IgProfileRowSchema, captionLength, type IgProfileRow } from '@mp/shared';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { DialogActions, DialogButton } from '../components/DialogActions';
import { Field } from '../components/Field';
import { Modal } from '../components/Modal';
import { Notice } from '../components/Notice';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { StaleNotice } from '../components/StaleNotice';
import { useToast } from '../components/Toast';
import { useConfirmAction } from '../components/useConfirmAction';
import { expectUpdatedAt, isStale } from '../data/concurrency';
import { useCanMutate } from '../data/health';
import { useIgProfile, useUpdateIgProfile } from '../data/planner';
import { cs } from '../i18n/cs';
import { fill } from '../i18n/format';
import { errorMessage } from '../i18n/messages';
import type { IgProfilePatch } from '../ports';
import { useAvatarCrop, useImageBase, usePorts } from '../ports-context';
import { AVATAR_INPUT_MAX_BYTES, AvatarCropError } from '../encode/cropSquare';

const t = cs.instagram.profile.dialog;

type AvatarUpload =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'uploading'; percent: number }
  | { kind: 'error'; message: string }
  | { kind: 'done' };

type FieldKey = 'username' | 'name' | 'bio' | 'link' | 'followers' | 'following';
type Problems = Partial<Record<FieldKey, string>>;

/** A whole number typed in a count field (spaces allowed as thousands separators); NaN when it is not one. */
function parseCount(text: string): number {
  const digits = text.replace(/[\s ]/g, '');
  return /^\d{1,9}$/.test(digits) ? Number(digits) : Number.NaN;
}

const FIELD_OF: Record<string, FieldKey> = {
  username: 'username',
  display_name: 'name',
  bio: 'bio',
  link: 'link',
  followers_count: 'followers',
  following_count: 'following',
};

/** Czech message of the first problem per field, from the shared schema (codes of the refinements in ig.ts). */
function messageFor(field: FieldKey, code: string): string {
  switch (field) {
    case 'username':
      return code === 'USERNAME_TOO_LONG' ? t.usernameTooLong : t.usernameInvalid;
    case 'name':
      return t.nameTooLong;
    case 'bio':
      return t.bioTooLong;
    case 'link':
      return code === 'LINK_TOO_LONG' ? t.linkTooLong : t.linkInvalid;
    default:
      return t.countInvalid;
  }
}

interface FormProps {
  /** The row the form is based on; its updated_at is sent as the precondition of the save. */
  base: IgProfileRow;
  onClose: () => void;
  onReload: () => void;
}

function ProfileForm({ base, onClose, onReload }: FormProps) {
  const imgBase = useImageBase();
  const { api, upload: uploadPort } = usePorts();
  const crop = useAvatarCrop();
  const toast = useToast();
  const canMutate = useCanMutate();
  const update = useUpdateIgProfile();
  const formRef = useRef<HTMLFormElement>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const bioHintId = useId();
  const avatarLegendId = useId();
  const [username, setUsername] = useState(base.username);
  const [name, setName] = useState(base.display_name);
  const [bio, setBio] = useState(base.bio);
  const [link, setLink] = useState(base.link);
  const [followers, setFollowers] = useState(String(base.followers_count));
  const [following, setFollowing] = useState(String(base.following_count));
  const [avatar, setAvatar] = useState<string | null>(base.avatar_key);
  const [upload, setUpload] = useState<AvatarUpload>({ kind: 'idle' });
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [problems, setProblems] = useState<Problems>({});
  const patchRef = useRef<IgProfilePatch | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const runRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const previewRef = useRef<string | null>(null);
  const avatarErrorId = useId();
  const busyUpload = upload.kind === 'preparing' || upload.kind === 'uploading';

  const { saving, failure, confirm } = useConfirmAction(async () => {
    const patch = patchRef.current;
    if (!patch) return;
    await update.mutateAsync({ patch, options: expectUpdatedAt(base) });
    toast.show(t.saved);
    // Superseded avatar files are removed best effort; a failure here never touches the saved profile.
    void (async () => {
      try {
        await api.cleanupIgAvatars();
      } catch {
        /* the next save tries again */
      }
    })();
    onClose();
  });

  function setPreview(blob: Blob | null) {
    if (previewRef.current !== null) URL.revokeObjectURL(previewRef.current);
    previewRef.current = blob === null ? null : URL.createObjectURL(blob);
    setPreviewSrc(previewRef.current);
  }

  // Leaving the dialog cancels a running upload and frees the preview.
  useEffect(
    () => () => {
      runRef.current += 1;
      abortRef.current?.abort();
      if (previewRef.current !== null) URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
    },
    [],
  );

  /** A new pick replaces whatever ran before (its late results are ignored). */
  async function pickFile(file: File) {
    runRef.current += 1;
    const run = runRef.current;
    const stale = () => runRef.current !== run;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (file.size > AVATAR_INPUT_MAX_BYTES) {
      setPreview(null);
      setUpload({ kind: 'error', message: t.inputTooLarge });
      return;
    }
    setUpload({ kind: 'preparing' });
    try {
      const blob = await crop(file);
      if (stale()) return;
      setPreview(blob);
      const reserved = await api.reserveIgAvatar(blob.size);
      if (stale()) return;
      setUpload({ kind: 'uploading', percent: 0 });
      await uploadPort.put(reserved.upload, blob, {
        signal: controller.signal,
        onProgress: (loaded, total) => {
          if (!stale()) setUpload({ kind: 'uploading', percent: total > 0 ? Math.round((loaded / total) * 100) : 0 });
        },
      });
      if (stale()) return;
      setAvatar(reserved.key);
      setUpload({ kind: 'done' });
    } catch (error) {
      if (stale()) return;
      setPreview(null);
      setUpload({ kind: 'error', message: error instanceof AvatarCropError ? error.userMessage : errorMessage(error) });
    }
  }

  function removeAvatar() {
    runRef.current += 1;
    abortRef.current?.abort();
    setPreview(null);
    setUpload({ kind: 'idle' });
    setAvatar(null);
    chooseRef.current?.focus();
  }

  // After a failed check the first invalid field gets focus (the message is linked to it with aria-describedby).
  useEffect(() => {
    if (Object.keys(problems).length > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [problems]);

  function clear(field: FieldKey) {
    setProblems((now) => {
      if (now[field] === undefined) return now;
      const next = { ...now };
      delete next[field];
      return next;
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || !canMutate || busyUpload) return;
    const values = {
      username: username.trim(),
      display_name: name.trim(),
      bio,
      link: link.trim(),
      followers_count: parseCount(followers),
      following_count: parseCount(following),
      avatar_key: avatar,
    };
    const checked = IgProfileRowSchema.safeParse({ ...base, ...values });
    if (!checked.success) {
      const found: Problems = {};
      for (const issue of checked.error.issues) {
        const field = FIELD_OF[String(issue.path[0])];
        if (field !== undefined && found[field] === undefined) found[field] = messageFor(field, issue.message);
      }
      setProblems(found);
      return;
    }
    setProblems({});
    patchRef.current = values;
    void confirm();
  }

  const bioLength = captionLength(bio);
  const typed = { display_name: name.trim(), username: username.trim(), avatar_key: avatar };

  return (
    <>
      <Modal title={t.title} onClose={onClose} busy={saving}>
        <form ref={formRef} className="form ig-profile-form" noValidate onSubmit={submit}>
          <p className="field-hint">{t.tip}</p>
          {failure === null ? null : isStale(failure) ? (
            <StaleNotice entity="profile" onReload={onReload} />
          ) : (
            <Notice>{errorMessage(failure)}</Notice>
          )}
          <fieldset className="ig-avatar-field" aria-labelledby={avatarLegendId}>
            <legend id={avatarLegendId}>{t.photo}</legend>
            <ProfileAvatar profile={typed} imgBase={imgBase} previewSrc={previewSrc} />
            <div className="ig-avatar-actions">
              <button
                ref={chooseRef}
                type="button"
                className="button"
                disabled={!canMutate}
                aria-describedby={upload.kind === 'error' ? avatarErrorId : undefined}
                onClick={() => fileRef.current?.click()}
              >
                {t.choosePhoto}
              </button>
              <input
                ref={fileRef}
                type="file"
                hidden
                tabIndex={-1}
                accept="image/jpeg,image/png,image/webp"
                data-testid="avatar-file"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = ''; // the same file can be picked again after an error
                  if (file) void pickFile(file);
                }}
              />
              <button type="button" className="button" disabled={avatar === null || !canMutate} onClick={removeAvatar}>
                {t.removePhoto}
              </button>
            </div>
            <p className="field-hint">{t.photoHint}</p>
            {avatar === null && upload.kind !== 'error' ? <p className="field-hint">{t.noPhoto}</p> : null}
            <div className="ig-avatar-status">
              <p role="status" className="field-hint">
                {upload.kind === 'preparing' ? t.preparing : upload.kind === 'uploading' ? t.uploading : upload.kind === 'done' ? t.uploaded : ''}
              </p>
              {upload.kind === 'uploading' ? (
                <progress className="storage-meter" max={100} value={upload.percent} aria-label={t.uploading} />
              ) : null}
              {upload.kind === 'error' ? (
                <p role="alert" id={avatarErrorId} className="field-error">
                  {upload.message}
                </p>
              ) : null}
            </div>
          </fieldset>
          <Field
            label={t.username}
            value={username}
            onChange={(value) => {
              setUsername(value);
              clear('username');
            }}
            error={problems.username}
            autoCapitalize="none"
            autofocus
          />
          <Field
            label={t.name}
            value={name}
            onChange={(value) => {
              setName(value);
              clear('name');
            }}
            error={problems.name}
          />
          <Field
            label={t.bio}
            value={bio}
            onChange={(value) => {
              setBio(value);
              clear('bio');
            }}
            multiline
            error={problems.bio}
            hintId={bioHintId}
            hint={
              <span role="status" aria-live="polite">
                {fill(t.bioCount, { n: bioLength })}
                {IG_BIO_MAX < bioLength ? <strong className="field-error"> {t.bioTooLong}</strong> : null}
              </span>
            }
          />
          <Field
            label={t.link}
            value={link}
            onChange={(value) => {
              setLink(value);
              clear('link');
            }}
            error={problems.link}
            autoCapitalize="none"
            inputMode="url"
          />
          <div className="ig-count-fields">
            <Field
              label={t.followers}
              value={followers}
              onChange={(value) => {
                setFollowers(value);
                clear('followers');
              }}
              error={problems.followers}
              inputMode="numeric"
            />
            <Field
              label={t.following}
              value={following}
              onChange={(value) => {
                setFollowing(value);
                clear('following');
              }}
              error={problems.following}
              inputMode="numeric"
            />
          </div>
          <DialogActions busy={saving} onClose={onClose}>
            <DialogButton kind="primary" type="submit" busy={saving} announceBusy disabled={!canMutate || busyUpload}>
              {saving ? t.saving : t.save}
            </DialogButton>
          </DialogActions>
        </form>
      </Modal>
    </>
  );
}

export function EditProfileDialog({ onClose }: { onClose: () => void }) {
  const query = useIgProfile();
  // The row the form starts from. It is replaced only by "Načíst znovu" (never by a background refetch), so the
  // precondition of a save is always the row the person saw.
  const [base, setBase] = useState<IgProfileRow | undefined>(query.data);
  const [epoch, setEpoch] = useState(0);
  if (!base) return null;
  const reload = () =>
    void query.refetch().then((result) => {
      if (result.data) setBase(result.data);
      setEpoch((n) => n + 1);
    });
  return <ProfileForm key={epoch} base={base} onClose={onClose} onReload={reload} />;
}
