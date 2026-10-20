import { useQueryClient } from '@tanstack/react-query';
import { cs } from '../i18n/cs';

/** "Toto album bylo změněno jinde. Načíst znovu.": shown when a save lost the updated_at race. Reload drops the cache. */
export function StaleNotice({ onReload }: { onReload?: () => void }) {
  const queryClient = useQueryClient();
  return (
    <div className="notice notice-error" role="alert">
      <p>{cs.data.staleSentence}</p>
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
