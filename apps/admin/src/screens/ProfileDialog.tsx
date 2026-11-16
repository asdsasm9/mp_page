/**
 * "Upravit profil" dialog of the Instagram preview (WP-15 step 9, T-364): the typed values of the profile (username,
 * name, bio with line breaks and a counter, link, followers, following) and the avatar photo, chosen with the album-then-photo
 * picker of the post editor in single-choice mode (circle preview, "Odebrat fotku" clears). Explicit "Uložit", no
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
import { useImageBase } from '../ports-context';
import { PostPhotoPicker } from './PostPhotoPicker';

const t = cs.instagram.profile.dialog;

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
  const [avatar, setAvatar] = useState<string | null>(base.avatar_photo_id);
  const [picking, setPicking] = useState(false);
  const [problems, setProblems] = useState<Problems>({});
  const patchRef = useRef<IgProfilePatch | null>(null);

  const { saving, failure, confirm } = useConfirmAction(async () => {
    const patch = patchRef.current;
    if (!patch) return;
    await update.mutateAsync({ patch, options: expectUpdatedAt(base) });
    toast.show(t.saved);
    onClose();
  });

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
    if (saving || !canMutate) return;
    const values = {
      username: username.trim(),
      display_name: name.trim(),
      bio,
      link: link.trim(),
      followers_count: parseCount(followers),
      following_count: parseCount(following),
      avatar_photo_id: avatar,
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
  const typed = { display_name: name.trim(), username: username.trim(), avatar_photo_id: avatar };

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
            <ProfileAvatar profile={typed} imgBase={imgBase} />
            <div className="ig-avatar-actions">
              <button ref={chooseRef} type="button" className="button" disabled={!canMutate} onClick={() => setPicking(true)}>
                {t.choosePhoto}
              </button>
              <button
                type="button"
                className="button"
                disabled={avatar === null || !canMutate}
                onClick={() => {
                  setAvatar(null);
                  chooseRef.current?.focus();
                }}
              >
                {t.removePhoto}
              </button>
            </div>
            {avatar === null ? <p className="field-hint">{t.noPhoto}</p> : null}
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
            <DialogButton kind="primary" type="submit" busy={saving} announceBusy disabled={!canMutate}>
              {saving ? t.saving : t.save}
            </DialogButton>
          </DialogActions>
        </form>
      </Modal>
      {picking ? (
        <PostPhotoPicker
          selected={avatar === null ? [] : [avatar]}
          max={1}
          title={t.photoPickerTitle}
          hint={t.photoPickerHint}
          onClose={() => setPicking(false)}
          onConfirm={(ids) => {
            setAvatar(ids[0] ?? null);
            setPicking(false);
          }}
        />
      ) : null}
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
