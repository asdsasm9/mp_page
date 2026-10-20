import { Link } from 'react-router-dom';
import { useStorage } from '../data/storage';
import { cs, glossary } from '../i18n/cs';
import { describeStorage, percentText, usageLine } from '../i18n/storageText';

/**
 * Storage usage bar (ADMIN-UX 3.7). `mini` sits in the top bar and links to /ulozeni; `large` is the
 * categories / storage screen version with the full level sentence (ok: plain, warn: role=status,
 * full: role=alert). Numbers and level come straight from GET /storage; state is text plus bar, never colour alone.
 */
export function StorageBar({ variant }: { variant: 'mini' | 'large' }) {
  const storage = useStorage();
  const className = `storage storage-${variant}`;

  if (!storage.data) {
    return (
      <p className={className} role={storage.isError ? undefined : 'status'} aria-busy={!storage.isError}>
        {storage.isError ? cs.storage.loadFailed : cs.storage.loading}
      </p>
    );
  }

  const view = describeStorage(storage.data);
  const meter = (
    <progress
      className="storage-meter"
      data-level={view.level}
      max={Math.max(storage.data.hard, 1)}
      value={Math.min(storage.data.used_bytes, Math.max(storage.data.hard, 1))}
      aria-label={cs.storage.barLabel}
    />
  );

  if (variant === 'mini') {
    return (
      <Link to="/ulozeni" className={className} data-level={view.level}>
        <span className="storage-line">
          {usageLine(view)}
          {view.shortState ? <strong className="storage-state">{view.shortState}</strong> : null}
        </span>
        {meter}
      </Link>
    );
  }

  return (
    <section className={className} data-level={view.level} aria-label={glossary.storage}>
      <p className="storage-text" role={view.role}>
        {view.text}
      </p>
      {meter}
      <p className="storage-percent">{percentText(view.percent)}</p>
    </section>
  );
}
