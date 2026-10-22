/** Publish screen (`/zverejnit`, ADMIN-UX 3.6): button, live status, pending count and the last 10 publishes. */
import type { PublishLogRow } from '@mp/shared';
import { useCanMutate } from '../data/health';
import { usePublishLog, useSiteState } from '../data/catalog';
import { isPublishFailure, usePublishFlow, type PublishPhase } from '../data/publish';
import { useDocumentTitle } from '../components/Page';
import { LoadFailure } from '../components/LoadFailure';
import { cs } from '../i18n/cs';
import { fill, formatCount, formatPragueDateTime, plural } from '../i18n/format';
import { errorMessage } from '../i18n/messages';
import { useSiteUrl } from '../ports-context';

const HISTORY_LIMIT = 10;

function liveText(phase: PublishPhase, repeatPressed: boolean): string {
  if (repeatPressed && (phase.kind === 'starting' || phase.kind === 'building')) return cs.publish.alreadyRunning;
  switch (phase.kind) {
    case 'building':
      return cs.publish.building;
    case 'triggered':
      return cs.publish.triggered;
    case 'done':
      return cs.publish.done;
    default:
      return '';
  }
}

function failureText(phase: PublishPhase): string {
  if (phase.kind === 'timeout') return cs.publish.timeout;
  if (phase.kind !== 'failed') return '';
  return isPublishFailure(phase.error) ? cs.publish.failed : errorMessage(phase.error);
}

function logSummary(row: PublishLogRow): string {
  if (row.status !== 'ok' || row.album_count === null || row.photo_count === null) return '';
  return fill(cs.publish.logCounts, {
    albums: formatCount(row.album_count, cs.units.album),
    photos: formatCount(row.photo_count, cs.units.photo),
  });
}

function History() {
  const log = usePublishLog(HISTORY_LIMIT);
  if (log.isError) return <p className="page-note">{cs.publish.historyLoadFailed}</p>;
  if (!log.data) return <p className="page-note">{cs.data.loading}</p>;
  if (log.data.length === 0) return <p className="page-note">{cs.publish.historyEmpty}</p>;
  return (
    <ul className="publish-history" aria-label={cs.publish.historyLabel}>
      {log.data.slice(0, HISTORY_LIMIT).map((row) => (
        <li key={row.id} className="publish-history-row" data-status={row.status}>
          <time dateTime={row.requested_at}>{formatPragueDateTime(row.requested_at)}</time>
          <span className="publish-history-status">{cs.publish.log[row.status]}</span>
          <span className="page-note">{logSummary(row)}</span>
        </li>
      ))}
    </ul>
  );
}

export function PublishScreen() {
  useDocumentTitle(cs.routes.publish.title);
  const site = useSiteState();
  const canMutate = useCanMutate();
  const siteUrl = useSiteUrl();
  const { phase, busy, repeatPressed, publish } = usePublishFlow();

  const pending = site.data?.pending_changes ?? 0;
  const noChanges = site.data !== undefined && pending === 0 && !busy;
  // While busy the button stays focusable (aria-disabled) so a repeat press can explain itself.
  const disabled = !canMutate || noChanges || site.data === undefined;
  const live = liveText(phase, repeatPressed);
  const failure = failureText(phase);
  const last = site.data?.last_published_at;

  return (
    <div className="page">
      <h1>{cs.routes.publish.title}</h1>
      {site.isError ? (
        <LoadFailure error={site.error} message={cs.publish.loadFailed} onRetry={() => void site.refetch()} />
      ) : (
        <section
          className="card publish-card"
          aria-label={cs.publish.statusLabel}
          data-state={site.data ? (pending > 0 ? 'pending' : 'clean') : 'loading'}
        >
          {pending > 0 ? (
            <p className="publish-flag">
              <span className="pending-dot" aria-hidden="true" />
              {cs.publishIndicator.pending}
            </p>
          ) : null}
          <p className="publish-status">
            {site.data
              ? pending > 0
                ? fill(plural(pending, cs.publish.pending), { count: pending })
                : busy
                  ? ''
                  : cs.publish.noChanges
              : cs.data.loading}
          </p>
          <p className="page-note">{last ? fill(cs.publish.lastPublished, { date: formatPragueDateTime(last) }) : cs.publish.neverPublished}</p>
          <p>
            <button
              type="button"
              className={pending > 0 ? 'button button-primary' : 'button'}
              disabled={disabled}
              aria-disabled={busy ? true : undefined}
              onClick={publish}
            >
              {busy ? cs.publish.busy : cs.publish.button}
            </button>
          </p>
          <div className="publish-live" role="status" aria-live="polite">
            {live}
          </div>
          {phase.kind === 'done' ? (
            <p>
              <a className="button" href={siteUrl === '' ? '/' : siteUrl} target="_blank" rel="noopener noreferrer">
                {cs.publish.showSite}
              </a>
            </p>
          ) : null}
          {failure ? (
            <div className="notice notice-error" role="alert">
              {failure}
            </div>
          ) : null}
        </section>
      )}
      <section aria-labelledby="publish-history-title">
        <h2 id="publish-history-title">{cs.publish.historyTitle}</h2>
        <History />
      </section>
    </div>
  );
}
