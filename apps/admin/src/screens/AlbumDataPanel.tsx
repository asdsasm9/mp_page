/** "Udaje o albu" (ADMIN-UX 3.4): collapsible form that saves each field when it loses focus. */
import type { AlbumRow } from '@mp/shared';
import { useId } from 'react';
import { Field } from '../components/Field';
import { Modal } from '../components/Modal';
import { StaleNotice } from '../components/StaleNotice';
import { ALBUM_LIMITS } from '../data/albumFields';
import { useCanMutate } from '../data/health';
import { cs, glossary } from '../i18n/cs';
import { fill } from '../i18n/format';
import type { useAlbumAutosave } from './useAlbumAutosave';

type Autosave = ReturnType<typeof useAlbumAutosave>;

export function SaveStatus({ autosave }: { autosave: Autosave }) {
  const canMutate = useCanMutate();
  return (
    <div className="save-state">
      <p className="save-status" role="status" aria-live="polite">
        {autosave.status === 'saving' ? cs.album.saving : autosave.status === 'saved' ? cs.album.saved : ''}
      </p>
      {autosave.failures.length > 0 ? (
        <div className="notice notice-error" role="alert">
          <p>{cs.data.saveFailed}</p>
          <button type="button" className="button" disabled={!canMutate} onClick={autosave.retry}>
            {glossary.retry}
          </button>
        </div>
      ) : null}
      {autosave.stale ? <StaleNotice entity="album" onReload={autosave.reload} /> : null}
    </div>
  );
}

export function AlbumDataPanel({ album, autosave }: { album: AlbumRow; autosave: Autosave }) {
  const slugHintId = useId();
  const seoTitleHintId = useId();
  const seoDescriptionHintId = useId();
  const shotOnHintId = useId();
  const { values, errors } = autosave;
  const slugDirty = values.slug.trim() !== album.slug;

  const field = (key: keyof typeof values) => ({
    value: values[key],
    error: errors[key],
    onChange: (text: string) => autosave.setValue(key, text),
    onBlur: () => void autosave.commit(key),
    onElement: autosave.register(key),
  });

  return (
    <details className="details panel" open>
      <summary>{cs.album.panel}</summary>
      <div className="form">
        <Field label={glossary.place} maxLength={ALBUM_LIMITS.place} onEnter={() => void autosave.commit('place')} {...field('place')} />
        <Field
          label={glossary.shotOn}
          type="date"
          hintId={shotOnHintId}
          hint={cs.album.shotOnHint}
          onEnter={() => void autosave.commit('shot_on')}
          {...field('shot_on')}
        />
        <Field label={glossary.description} multiline {...field('description')} />
        <Field
          label={glossary.address}
          maxLength={ALBUM_LIMITS.slug}
          autoCapitalize="none"
          hintId={slugHintId}
          onEnter={() => void autosave.commit('slug')}
          hint={
            <>
              <p role={slugDirty ? 'status' : undefined}>{slugDirty ? cs.album.slugChangeWarning : cs.album.slugHint}</p>
              {autosave.suggestion ? (
                <button type="button" className="button" onClick={autosave.applySuggestion}>
                  {fill(cs.album.slugSuggestion, { slug: autosave.suggestion })}
                </button>
              ) : null}
            </>
          }
          {...field('slug')}
        />
        <details className="details">
          <summary>{glossary.forSearchEngines}</summary>
          <div className="form">
            <Field
              label={glossary.seoTitle}
              hintId={seoTitleHintId}
              hint={
                <>
                  {fill(cs.album.seoTitleHint, { max: ALBUM_LIMITS.seoTitle })}{' '}
                  {fill(cs.album.counter, { count: values.seo_title.trim().length, max: ALBUM_LIMITS.seoTitle })}
                </>
              }
              onEnter={() => void autosave.commit('seo_title')}
              {...field('seo_title')}
            />
            <Field
              label={glossary.seoDescription}
              multiline
              hintId={seoDescriptionHintId}
              hint={
                <>
                  {fill(cs.album.seoDescriptionHint, { max: ALBUM_LIMITS.seoDescription })}{' '}
                  {fill(cs.album.counter, {
                    count: values.seo_description.trim().length,
                    max: ALBUM_LIMITS.seoDescription,
                  })}
                </>
              }
              {...field('seo_description')}
            />
          </div>
        </details>
      </div>
      {autosave.slugConfirm !== null ? (
        <Modal title={cs.album.slugConfirmTitle} onClose={autosave.cancelSlug}>
          <p>{cs.album.slugChangeWarning}</p>
          <div className="dialog-actions">
            <button type="button" className="button button-primary" onClick={autosave.confirmSlug}>
              {cs.album.slugConfirmApply}
            </button>
            <button type="button" className="button" data-autofocus="" onClick={autosave.cancelSlug}>
              {cs.album.slugConfirmRevert}
            </button>
          </div>
        </Modal>
      ) : null}
    </details>
  );
}
