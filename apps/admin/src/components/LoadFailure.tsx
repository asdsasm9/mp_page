import { cs, glossary } from '../i18n/cs';
import { errorCode } from '../i18n/messages';

interface Props {
  error: unknown;
  onRetry: () => void;
  /** Replaces "Nepodařilo se načíst data." */
  message?: string;
}

/** A failed load: one sentence, a retry button, the technical code only under "Podrobnosti". The page stays usable. */
export function LoadFailure({ error, onRetry, message = cs.data.loadFailed }: Props) {
  return (
    <div className="notice notice-error" role="alert">
      <p>{message}</p>
      <details className="details">
        <summary>{glossary.details}</summary>
        <p>{errorCode(error)}</p>
      </details>
      <button type="button" className="button" onClick={onRetry}>
        {glossary.retry}
      </button>
    </div>
  );
}
