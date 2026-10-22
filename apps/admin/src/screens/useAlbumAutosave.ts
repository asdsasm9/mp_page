/**
 * Autosave of the album data (ADMIN-UX 3.4): a field is saved when it loses focus (or on Enter), once per
 * change; an unchanged field saves nothing. Saves run one after another, each based on the row the previous
 * save returned, so quick tabbing through fields never trips the "changed elsewhere" check. A failed save
 * keeps the typed value and offers a retry; the address asks for confirmation before it is written.
 */
import { uniqueSlug, type AlbumRow } from '@mp/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ALBUM_FIELDS,
  ALBUM_LIMITS,
  fieldText,
  normalizeField,
  validateField,
  type AlbumField,
  type FieldProblem,
} from '../data/albumFields';
import { useUpdateAlbum } from '../data/catalog';
import { expectUpdatedAt, isStale } from '../data/concurrency';
import { cs } from '../i18n/cs';
import { fill } from '../i18n/format';
import { CatalogError } from '../ports';

export type SaveStatus = 'idle' | 'saving' | 'saved';

type Values = Record<AlbumField, string>;
type Element = HTMLInputElement | HTMLTextAreaElement;

interface Failure {
  key: AlbumField;
  value: string | null;
}

const initialValues = (album: AlbumRow): Values =>
  Object.fromEntries(ALBUM_FIELDS.map((key) => [key, fieldText(album, key)])) as Values;

/** The Czech text of a validation problem. */
export function problemText(problem: FieldProblem): string {
  const t = cs.album;
  switch (problem) {
    case 'titleRequired':
      return t.titleRequired;
    case 'titleTooLong':
      return fill(t.titleTooLong, { max: ALBUM_LIMITS.title });
    case 'placeTooLong':
      return fill(t.placeTooLong, { max: ALBUM_LIMITS.place });
    case 'shotOnInvalid':
      return t.shotOnInvalid;
    case 'slugRequired':
      return t.slugRequired;
    case 'slugInvalid':
      return t.slugInvalid;
    case 'slugTaken':
      return t.slugTaken;
    case 'seoTitleTooLong':
      return fill(t.seoTitleTooLong, { max: ALBUM_LIMITS.seoTitle });
    case 'seoDescriptionTooLong':
      return fill(t.seoDescriptionTooLong, { max: ALBUM_LIMITS.seoDescription });
  }
}

export function useAlbumAutosave(album: AlbumRow, allAlbums: readonly AlbumRow[], dataUpdatedAt: number) {
  const update = useUpdateAlbum();
  const [values, setValues] = useState<Values>(() => initialValues(album));
  const [errors, setErrors] = useState<Partial<Record<AlbumField, string>>>({});
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [failures, setFailures] = useState<Failure[]>([]);
  const [stale, setStale] = useState(false);
  const [slugConfirm, setSlugConfirm] = useState<string | null>(null);

  const valuesRef = useRef(values);
  valuesRef.current = values;
  const takenRef = useRef<readonly string[]>([]);
  takenRef.current = allAlbums.filter((a) => a.id !== album.id).map((a) => a.slug);

  /** The row as the server has it after every save made so far. */
  const baseRef = useRef(album);
  /** The value each field will have on the server once the queued saves are done (to skip repeated saves). */
  const targetRef = useRef<Record<AlbumField, string | null>>(targetsOf(album));
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef(0);
  const failedRef = useRef(false);
  const elements = useRef(new Map<AlbumField, Element>());
  const reloadingRef = useRef(false);

  function targetsOf(row: AlbumRow): Record<AlbumField, string | null> {
    return Object.fromEntries(ALBUM_FIELDS.map((key) => [key, normalizeField(key, fieldText(row, key))])) as Record<
      AlbumField,
      string | null
    >;
  }

  // After "Nacist znovu" the refetched row replaces what is on screen.
  useEffect(() => {
    if (!reloadingRef.current) return;
    reloadingRef.current = false;
    baseRef.current = album;
    targetRef.current = targetsOf(album);
    setValues(initialValues(album));
    setErrors({});
    setSuggestion(null);
    setFailures([]);
    failedRef.current = false;
    setStatus('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUpdatedAt]);

  const register = useCallback(
    (key: AlbumField) => (element: Element | null) => {
      if (element) elements.current.set(key, element);
      else elements.current.delete(key);
    },
    [],
  );

  const focus = (key: AlbumField) => elements.current.get(key)?.focus();

  const setError = (key: AlbumField, message: string | undefined) =>
    setErrors((current) => {
      const next = { ...current };
      if (message === undefined) delete next[key];
      else next[key] = message;
      return next;
    });

  function setValue(key: AlbumField, text: string) {
    setValues((current) => ({ ...current, [key]: text }));
    setError(key, undefined);
    setStatus((current) => (current === 'saved' ? 'idle' : current));
    if (key === 'slug') setSuggestion(null);
  }

  function save(key: AlbumField, value: string | null) {
    targetRef.current[key] = value;
    pendingRef.current += 1;
    failedRef.current = false;
    setFailures((current) => current.filter((f) => f.key !== key));
    setStatus('saving');
    chainRef.current = chainRef.current.then(async () => {
      try {
        const row = await update.mutateAsync({
          id: baseRef.current.id,
          patch: { [key]: value },
          options: expectUpdatedAt(baseRef.current),
        });
        baseRef.current = row;
      } catch (error) {
        failedRef.current = true;
        targetRef.current[key] = normalizeField(key, fieldText(baseRef.current, key));
        if (isStale(error)) {
          setStale(true);
        } else if (key === 'slug' && error instanceof CatalogError && error.code === 'DUPLICATE_SLUG') {
          setError('slug', problemText('slugTaken'));
          // The address list on screen is older than the clash, so the refused address is added to it.
          setSuggestion(uniqueSlug(value ?? '', [...takenRef.current, value ?? '']));
          focus('slug');
        } else {
          setFailures((current) => [...current.filter((f) => f.key !== key), { key, value }]);
        }
      } finally {
        pendingRef.current -= 1;
        if (pendingRef.current === 0) setStatus(failedRef.current ? 'idle' : 'saved');
      }
    });
  }

  /**
   * Called when a field loses focus or Enter is pressed. Returns false when the text is not valid (an error
   * is shown and focus goes back to the field); true otherwise, whether or not anything was saved.
   */
  function commit(key: AlbumField, override?: string): boolean {
    const text = override ?? valuesRef.current[key];
    const problem = validateField(key, text, { takenSlugs: takenRef.current, currentSlug: baseRef.current.slug });
    if (problem) {
      setError(key, problemText(problem));
      if (problem === 'slugTaken') setSuggestion(uniqueSlug(text.trim(), takenRef.current));
      focus(key);
      return false;
    }
    const normalized = normalizeField(key, text);
    if (normalized === targetRef.current[key]) return true;
    if (key === 'slug') setSlugConfirm(normalized);
    else save(key, normalized);
    return true;
  }

  function confirmSlug() {
    if (slugConfirm !== null) save('slug', slugConfirm);
    setSlugConfirm(null);
  }

  function cancelSlug() {
    setSlugConfirm(null);
    setValue('slug', fieldText(baseRef.current, 'slug'));
  }

  function applySuggestion() {
    if (suggestion === null) return;
    setValue('slug', suggestion);
    commit('slug', suggestion);
  }

  function retry() {
    const again = failures;
    again.forEach((f) => save(f.key, f.value));
  }

  function reload() {
    reloadingRef.current = true;
    setStale(false);
  }

  function revert(key: AlbumField) {
    setValue(key, fieldText(baseRef.current, key));
  }

  return {
    values,
    errors,
    suggestion,
    status,
    failures,
    stale,
    slugConfirm,
    setValue,
    commit,
    revert,
    register,
    focus,
    confirmSlug,
    cancelSlug,
    applySuggestion,
    retry,
    reload,
  };
}
