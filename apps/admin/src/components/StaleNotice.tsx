import { useQueryClient } from '@tanstack/react-query';
import { cs } from '../i18n/cs';

/**
 * "Toto album bylo změněno jinde. Načíst znovu.": shown when a save lost the updated_at race. The sentence
 * follows the entity that was saved (default album). Reload drops the cache.
 */
export function StaleNotice({
  onReload,
  entity = 'album',
}: {
  onReload?: () => void;
  entity?: keyof typeof cs.data.staleSentenceBy;
}) {
  const queryClient = useQueryClient();
  return (
    <div className="notice notice-error" role="alert">
      <p>{cs.data.staleSentenceBy[entity]}</p>
      <button
        type="button"
        className="button"
        onClick={() => {
          void queryClient.invalidateQueries();
          onReload?.();
        }}
      >
        {cs.data.reload}
      </button>
    </div>
  );
}
