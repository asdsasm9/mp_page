/** Dialogs of the categories screen: create / edit (ADMIN-UX 3.2), hide (F4) and delete (F5). */
import { isReservedCategorySlug, isValidSlug, slugify, uniqueSlug, type CategoryRow } from '@mp/shared';
import { useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { Modal } from '../components/Modal';
import { StaleNotice } from '../components/StaleNotice';
import { useCreateCategory, useDeleteCategory, useUpdateCategory } from '../data/catalog';
import { expectUpdatedAt, isStale } from '../data/concurrency';
import { useCanMutate } from '../data/health';
import { nextSortAfterLast } from '../data/order';
import { cs, glossary } from '../i18n/cs';
import { fill, formatCount } from '../i18n/format';
import { errorMessage } from '../i18n/messages';
import { CatalogError } from '../ports';

function ErrorLine({ error, onReload }: { error: unknown; onReload: () => void }) {
  if (error === null) return null;
  if (isStale(error)) return <StaleNotice entity="category" onReload={onReload} />;
  return (
    <p className="notice notice-error" role="alert">
      {errorMessage(error)} {cs.categories.saveFailedHint}
    </p>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  error?: string | undefined;
  hint?: ReactNode;
  hintId?: string;
  multiline?: boolean;
  maxLength?: number;
  inputRef?: RefObject<HTMLInputElement>;
  autofocus?: boolean;
  autoCapitalize?: string;
}

function Field({
  label,
  value,
  onChange,
  required,
  error,
  hint,
  hintId,
  multiline,
  maxLength,
  inputRef,
  autofocus,
  autoCapitalize,
}: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  const common = {
    id,
    value,
    maxLength,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    'data-autofocus': autofocus ? '' : undefined,
  } as const;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? <span className="required"> {cs.categories.required}</span> : null}
      </label>
      {multiline ? (
        <textarea {...common} rows={3} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input
          {...common}
          ref={inputRef}
          type="text"
          autoCapitalize={autoCapitalize}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {error ? (
        <p id={errorId} className="field-error">
          {error}
        </p>
      ) : null}
      {hint ? (
        <div id={hintId} className="field-hint">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

interface FormProps {
  /** Missing: create. */
  category?: CategoryRow;
  /** All categories (slug uniqueness, position of a new one). */
  categories: readonly CategoryRow[];
  onClose: () => void;
}

/** "Nová kategorie" / "Upravit kategorii": name, address (auto from the name, editable, unique), description, SEO. */
export function CategoryFormDialog({ category, categories, onClose }: FormProps) {
  const editing = category !== undefined;
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const canMutate = useCanMutate();
  const warningId = useId();
  const suggestionId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(category?.name ?? '');
  const [slug, setSlug] = useState(category?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(editing);
  const [description, setDescription] = useState(category?.description ?? '');
  const [seoTitle, setSeoTitle] = useState(category?.seo_title ?? '');
  const [seoDescription, setSeoDescription] = useState(category?.seo_description ?? '');
  const [nameError, setNameError] = useState<string | undefined>();
  const [slugError, setSlugError] = useState<string | undefined>();
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const others = categories.filter((c) => c.id !== category?.id).map((c) => c.slug);
  const slugChanged = editing && slug !== category.slug && slug.trim() !== '';

  function changeName(value: string) {
    setName(value);
    setNameError(undefined);
    if (!slugTouched) {
      setSlug(slugify(value));
      setSlugError(undefined);
      setSuggestion(null);
    }
  }

  function changeSlug(value: string) {
    setSlugTouched(true);
    setSlug(value);
    setSlugError(undefined);
    setSuggestion(null);
  }

  /** The error text for an address, or undefined when it is fine. */
  function slugProblem(value: string): string | undefined {
    if (value === '') return cs.categories.slugRequired;
    if (!isValidSlug(value)) return cs.categories.slugInvalid;
    if (isReservedCategorySlug(value)) return cs.categories.slugReserved;
    if (others.includes(value)) return cs.categories.slugTaken;
    return undefined;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setFailure(null);
    const trimmedName = name.trim();
    const nextSlug = slug.trim();
    const nameProblem = trimmedName === '' ? cs.categories.nameRequired : undefined;
    const addressProblem = slugProblem(nextSlug);
    setNameError(nameProblem);
    setSlugError(addressProblem);
    setSuggestion(addressProblem === cs.categories.slugTaken ? uniqueSlug(nextSlug, others) : null);
    if (nameProblem) return nameRef.current?.focus();
    if (addressProblem) return slugRef.current?.focus();

    const fields = {
      name: trimmedName,
      slug: nextSlug,
      description: orNull(description),
      seo_title: orNull(seoTitle),
      seo_description: orNull(seoDescription),
    };
    setSaving(true);
    try {
      if (editing) {
        await update.mutateAsync({ id: category.id, patch: fields, options: expectUpdatedAt(category) });
      } else {
        await create.mutateAsync({ ...fields, sort: nextSortAfterLast(categories), visible: true });
      }
      onClose();
    } catch (error) {
      if (error instanceof CatalogError && error.code === 'DUPLICATE_SLUG') {
        setSlugError(cs.categories.slugTaken);
        setSuggestion(uniqueSlug(nextSlug, others));
        slugRef.current?.focus();
      } else {
        setFailure(error);
      }
      setSaving(false);
    }
  }

  const title = editing ? cs.categories.editTitle : glossary.newCategory;
  return (
    <Modal title={title} onClose={onClose} busy={saving}>
      <form className="form" noValidate onSubmit={onSubmit} aria-busy={saving}>
        <Field
          label={glossary.name}
          required
          value={name}
          onChange={changeName}
          error={nameError}
          maxLength={80}
          inputRef={nameRef}
          autofocus
        />
        <Field
          label={glossary.address}
          required
          value={slug}
          onChange={changeSlug}
          error={slugError}
          maxLength={60}
          inputRef={slugRef}
          autoCapitalize="none"
          hintId={suggestionId}
          hint={
            <>
              {slugChanged ? (
                <p id={warningId} role="status">
                  {cs.categories.slugChangeWarning}
                </p>
              ) : (
                <p>{cs.categories.slugHint}</p>
              )}
              {suggestion ? (
                <button type="button" className="button" onClick={() => changeSlug(suggestion)}>
                  {fill(cs.categories.slugSuggestion, { slug: suggestion })}
                </button>
              ) : null}
            </>
          }
        />
        <Field label={glossary.description} value={description} onChange={setDescription} multiline />
        <details className="details">
          <summary>{glossary.forSearchEngines}</summary>
          <div className="form">
            <Field label={glossary.seoTitle} value={seoTitle} onChange={setSeoTitle} maxLength={120} />
            <Field
              label={glossary.seoDescription}
              value={seoDescription}
              onChange={setSeoDescription}
              maxLength={300}
              multiline
            />
          </div>
        </details>
        <ErrorLine error={failure} onReload={onClose} />
        <div className="dialog-actions">
          <button type="submit" className="button button-primary" disabled={!canMutate || saving}>
            {saving ? cs.categories.saving : editing ? glossary.save : cs.categories.create}
          </button>
          <button type="button" className="button" disabled={saving} onClick={onClose}>
            {glossary.cancel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface ConfirmProps {
  category: CategoryRow;
  albumCount: number;
  onClose: () => void;
}

/** F4: light confirmation (no typing) that says how many albums disappear with the category. */
export function HideCategoryDialog({ category, albumCount, onClose }: ConfirmProps) {
  const update = useUpdateCategory();
  const canMutate = useCanMutate();
  const [failure, setFailure] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  async function confirm() {
    setSaving(true);
    setFailure(null);
    try {
      await update.mutateAsync({ id: category.id, patch: { visible: false }, options: expectUpdatedAt(category) });
      onClose();
    } catch (error) {
      setFailure(error);
      setSaving(false);
    }
  }

  const body =
    albumCount > 0
      ? fill(cs.categories.hideBodyWithAlbums, { albums: formatCount(albumCount, cs.units.album) })
      : cs.categories.hideBody;
  return (
    <Modal title={fill(cs.categories.hideTitle, { name: category.name })} onClose={onClose} busy={saving}>
      <p>{body}</p>
      <ErrorLine error={failure} onReload={onClose} />
      <div className="dialog-actions">
        <button
          type="button"
          className="button button-primary"
          data-autofocus=""
          disabled={!canMutate || saving}
          aria-busy={saving}
          onClick={() => void confirm()}
        >
          {saving ? cs.categories.saving : cs.categories.hide}
        </button>
        <button type="button" className="button" disabled={saving} onClick={onClose}>
          {glossary.cancel}
        </button>
      </div>
    </Modal>
  );
}

/**
 * F5: a category is deleted only while empty. With albums inside the dialog only explains and offers
 * "Zavřít"; no delete request is made.
 */
export function DeleteCategoryDialog({
  category,
  albumCount,
  onClose,
  onDeleted,
}: ConfirmProps & { /** Called once the category is gone (its row, and so the opener, no longer exists). */ onDeleted?: () => void }) {
  const remove = useDeleteCategory();
  const canMutate = useCanMutate();
  const [failure, setFailure] = useState<unknown>(null);
  const [deleting, setDeleting] = useState(false);
  const title = fill(cs.categories.deleteTitle, { name: category.name });

  if (albumCount > 0) {
    return (
      <Modal title={title} onClose={onClose}>
        <p>{fill(cs.categories.deleteNotEmpty, { albums: formatCount(albumCount, cs.units.album) })}</p>
        <div className="dialog-actions">
          <button type="button" className="button button-primary" data-autofocus="" onClick={onClose}>
            {cs.categories.close}
          </button>
        </div>
      </Modal>
    );
  }

  async function confirm() {
    setDeleting(true);
    setFailure(null);
    try {
      await remove.mutateAsync(category.id);
      onDeleted?.();
      onClose();
    } catch (error) {
      setFailure(error);
      setDeleting(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} busy={deleting}>
      <p>{cs.categories.deleteBody}</p>
      <ErrorLine error={failure} onReload={onClose} />
      <div className="dialog-actions">
        <button
          type="button"
          className="button button-danger"
          disabled={!canMutate || deleting}
          aria-busy={deleting}
          onClick={() => void confirm()}
        >
          {deleting ? cs.categories.deleting : glossary.delete}
        </button>
        <button type="button" className="button" data-autofocus="" disabled={deleting} onClick={onClose}>
          {glossary.cancel}
        </button>
      </div>
    </Modal>
  );
}
