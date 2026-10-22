import { NavLink } from 'react-router-dom';
import { usePendingCount } from '../data/catalog';
import { cs } from '../i18n/cs';

/**
 * Link to the publish screen with the "unpublished changes" indicator: a dot plus the words (never colour
 * alone), shown when the change log has lines (T-251; the same count the publish screen shows). On the phone bottom nav the words are visually hidden
 * but still read out.
 */
export function PublishLink({ label, className }: { label: string; className: string }) {
  const pending = (usePendingCount() ?? 0) > 0;
  return (
    <NavLink to="/zverejnit" className={className} data-pending={pending ? 'true' : undefined}>
      {label}
      {pending ? (
        <>
          <span className="pending-dot" aria-hidden="true" />
          <span className="pending-label">{cs.publishIndicator.pending}</span>
        </>
      ) : null}
    </NavLink>
  );
}
