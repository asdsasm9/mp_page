import { useQueryClient } from '@tanstack/react-query';
import { useOnline, useServiceUnavailable } from '../data/health';
import { cs, glossary } from '../i18n/cs';

/**
 * Offline banner (mutating controls are disabled through useCanMutate) and the "service unavailable"
 * banner with a retry. The wrapper is a persistent polite live region so appearing banners are announced.
 */
export function StatusBanners() {
  const online = useOnline();
  const unavailable = useServiceUnavailable();
  const queryClient = useQueryClient();
  return (
    <div className="banners" role="status">
      {online ? null : <p className="banner banner-warning">{cs.data.offline}</p>}
      {unavailable ? (
        <div className="banner banner-warning">
          <p>{cs.data.unavailable}</p>
          <button type="button" className="button" onClick={() => void queryClient.invalidateQueries()}>
            {glossary.retry}
          </button>
        </div>
      ) : null}
    </div>
  );
}
