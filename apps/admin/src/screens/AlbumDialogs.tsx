/** Dialogs of the album screens: new album (F1), hide (F4), move to another category (F7). */
import { slugify, uniqueSlug, type AlbumRow, type CategoryRow } from '@mp/shared';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Field } from '../components/Field';
import { Modal } from '../components/Modal';
import { albumActionMessage, useAlbumActions } from '../data/albumActions';
import { ALBUM_LIMITS, isValidShotOn } from '../data/albumFields';
import { useCreateAlbum } from '../data/catalog';
import { useCanMutate } from '../data/health';
import { nextSortAfterLast, sortedRows } from '../data/order';
import { cs, glossary } from '../i18n/cs';
import { fill } from '../i18n/format';
import { CatalogError } from '../ports';
import { ErrorLine } from './CategoryDialogs';

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

interface NewAlbumProps {
  categories: readonly CategoryRow[];
  /** Every album (addresses are unique across categories). */
  albums: readonly AlbumRow[];
  defaultCategoryId: string;
  onClose: () => void;
  onCreated: (album: AlbumRow) => void;
}

/** "Nove album": title (required), category (preselected), place, date. The address is made from the title. */
export function NewAlbumDialog({ categories, albums, defaultCategoryId, onClose, onCreated }: NewAlbumProps) {
  const create = useCreateAlbum();
  const canMutate = useCanMutate();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState(defaultCategoryId);
  const [place, setPlace] = useState('');
  const [shotOn, setShotOn] = useState('');
  const [titleError, setTitleError] = useState<string | undefined>();
  const [shotOnError, setShotOnError] = useState<string | undefined>();
  const [failure, setFailure] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [triedSlugs, setTriedSlugs] = useState<string[]>([]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setFailure(null);
    const trimmed = title.trim();
    const titleProblem =
      trimmed === ''
        ? cs.album.titleRequired
        : trimmed.length > ALBUM_LIMITS.title
          ? fill(cs.album.titleTooLong, { max: ALBUM_LIMITS.title })
          : undefined;
    const dateProblem = shotOn !== '' && !isValidShotOn(shotOn) ? cs.album.shotOnInvalid : undefined;
    setTitleError(titleProblem);
    setShotOnError(dateProblem);
    if (titleProblem) return titleRef.current?.focus();
    if (dateProblem) return;

    const base = slugify(trimmed);
    const slug = uniqueSlug(base.length >= 2 ? base : 'album', [...albums.map((a) => a.slug), ...triedSlugs]);
    setSaving(true);
    try {
      const row = await create.mutateAsync({
        category_id: categoryId,
        slug,
        title: trimmed,
        place: orNull(place),
        shot_on: orNull(shotOn),
        sort: nextSortAfterLast(albums.filter((a) => a.category_id === categoryId)),
        published: false,
      });
      onCreated(row);
    } catch (error) {
      if (error instanceof CatalogError && error.code === 'DUPLICATE_SLUG') setTriedSlugs((t) => [...t, slug]);
      setFailure(error);
      setSaving(false);
    }
  }

  return (
    <Modal title={cs.albums.createTitle} onClose={onClose} busy={saving}>
      <form className="form" noValidate onSubmit={onSubmit} aria-busy={saving}>
        <Field
          label={glossary.name}
          required
          value={title}
          onChange={(v) => {
            setTitle(v);
            setTitleError(undefined);
          }}
          error={titleError}
          maxLength={ALBUM_LIMITS.title}
          inputRef={titleRef}
          autofocus
        />
        <SelectField
          label={cs.albums.categoryLabel}
          value={categoryId}
          onChange={setCategoryId}
          options={sortedRows(categories).map((c) => ({ value: c.id, label: c.name }))}
        />
        <Field label={glossary.place} value={place} onChange={setPlace} maxLength={ALBUM_LIMITS.place} />
        <Field
          label={glossary.shotOn}
          type="date"
          value={shotOn}
          onChange={(v) => {
            setShotOn(v);
            setShotOnError(undefined);
          }}
          error={shotOnError}
        />
        <ErrorLine error={failure} entity="album" onReload={onClose} message={albumActionMessage} />
        <div className="dialog-actions">
          <button type="submit" className="button button-primary" disabled={!canMutate || saving}>
            {saving ? cs.categories.saving : cs.albums.create}
          </button>
          <button type="button" className="button" disabled={saving} onClick={onClose}>
            {glossary.cancel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** F4: light confirmation (no typing) before an album disappears from the public site. */
export function HideAlbumDialog({ album, onClose }: { album: AlbumRow; onClose: () => void }) {
  const actions = useAlbumActions();
  const canMutate = useCanMutate();
  const [failure, setFailure] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  async function confirm() {
    setSaving(true);
    setFailure(null);
    try {
      await actions.hide(album);
      onClose();
    } catch (error) {
      setFailure(error);
      setSaving(false);
    }
  }

  return (
    <Modal title={fill(cs.albums.hideTitle, { title: album.title })} onClose={onClose} busy={saving}>
      <p>{cs.albums.hideBody}</p>
      <ErrorLine error={failure} entity="album" onReload={onClose} message={albumActionMessage} />
      <div className="dialog-actions">
        <button
          type="button"
          className="button button-primary"
          data-autofocus=""
          disabled={!canMutate || saving}
          aria-busy={saving}
          onClick={() => void confirm()}
        >
          {saving ? cs.categories.saving : glossary.hideAlbum}
        </button>
        <button type="button" className="button" disabled={saving} onClick={onClose}>
          {glossary.cancel}
        </button>
      </div>
    </Modal>
  );
}

interface MoveProps {
  album: AlbumRow;
  categories: readonly CategoryRow[];
  /** Every album (the moved one goes to the end of the target category). */
  albums: readonly AlbumRow[];
  onClose: () => void;
}

/** "Presunout do jine kategorie": the album goes to the end of the chosen category. */
export function MoveAlbumDialog({ album, categories, albums, onClose }: MoveProps) {
  const actions = useAlbumActions();
  const canMutate = useCanMutate();
  const targets = sortedRows(categories).filter((c) => c.id !== album.category_id);
  const [categoryId, setCategoryId] = useState(targets[0]?.id ?? '');
  const [failure, setFailure] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  async function confirm() {
    setSaving(true);
    setFailure(null);
    try {
      await actions.move(album, categoryId, albums);
      onClose();
    } catch (error) {
      setFailure(error);
      setSaving(false);
    }
  }

  return (
    <Modal title={fill(cs.albums.moveTitle, { title: album.title })} onClose={onClose} busy={saving}>
      {targets.length === 0 ? (
        <>
          <p>{cs.albums.moveNoTarget}</p>
          <div className="dialog-actions">
            <button type="button" className="button button-primary" data-autofocus="" onClick={onClose}>
              {cs.categories.close}
            </button>
          </div>
        </>
      ) : (
        <>
          <SelectField
            label={cs.albums.moveLabel}
            value={categoryId}
            onChange={setCategoryId}
            options={targets.map((c) => ({ value: c.id, label: c.name }))}
          />
          <ErrorLine error={failure} entity="album" onReload={onClose} message={albumActionMessage} />
          <div className="dialog-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={!canMutate || saving || categoryId === ''}
              aria-busy={saving}
              onClick={() => void confirm()}
            >
              {saving ? cs.categories.saving : glossary.move}
            </button>
            <button type="button" className="button" disabled={saving} onClick={onClose}>
              {glossary.cancel}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
