import { isStale } from '../data/concurrency';
import { cs } from '../i18n/cs';
import { errorMessage } from '../i18n/messages';
import { StaleNotice } from './StaleNotice';

/** The failure of a dialog's save: "changed elsewhere" with a reload button, or the Czech error text. */
export function ErrorLine({
  error,
  onReload,
  entity = 'category',
  message = errorMessage,
}: {
  error: unknown;
  onReload: () => void;
  entity?: 'album' | 'category';
  message?: (error: unknown) => string;
}) {
  if (error === null) return null;
  if (isStale(error)) return <StaleNotice entity={entity} onReload={onReload} />;
  return (
    <p className="notice notice-error" role="alert">
      {message(error)} {cs.categories.saveFailedHint}
    </p>
  );
}
