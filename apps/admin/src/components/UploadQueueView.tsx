import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAlbums } from '../data/catalog';
import { cs, glossary } from '../i18n/cs';
import { fill, formatBytes } from '../i18n/format';
import { usePorts } from '../ports-context';
import { summarize } from '../upload/reducer';
import { stepLabel, summaryText } from '../upload/summary';
import { isTerminal, type QueueItem } from '../upload/types';
import { useUploadActions, useUploadState } from '../upload/UploadProvider';

/** Intrinsic size attributes of the row thumbnail (CSS sets the real size from --target-min, 2.75rem). */
const THUMB_PX = 44;

/** Fraction shown in a row's bar: real byte progress while uploading, full once past it. */
function barValue(item: QueueItem): number {
  if (item.status === 'done' || item.status === 'uploaded' || item.status === 'committing') return 1;
  if (item.status === 'uploading') return item.progress;
  return 0;
}

/** "Zpracovávám" has no measurable progress: the bar is indeterminate (no value) while the browser encodes. */
function processing(item: QueueItem): boolean {
  return !item.paused && (item.status === 'encoding' || item.status === 'encoded' || item.status === 'reserving');
}

function Thumb({ id }: { id: string }) {
  const actions = useUploadActions();
  const [broken, setBroken] = useState(false);
  const url = actions.previewFor(id);
  // HEIC cannot be shown by most browsers: the row then keeps an empty frame.
  if (!url || broken) return <span className="upload-thumb" aria-hidden="true" />;
  return <img className="upload-thumb" src={url} alt="" width={THUMB_PX} height={THUMB_PX} onError={() => setBroken(true)} />;
}

function FileRow({ item, albumTitle }: { item: QueueItem; albumTitle: string | undefined }) {
  const actions = useUploadActions();
  const step = stepLabel(item);
  const failed = item.status === 'failed';
  const finished = isTerminal(item.status);
  return (
    <li className="upload-row" data-status={item.status}>
      <Thumb id={item.id} />
      <div className="upload-info">
        <p className="upload-name">{item.name}</p>
        <p className="upload-meta">
          {albumTitle ? `${fill(cs.upload.album, { title: albumTitle })}${cs.upload.separator}` : ''}
          {formatBytes(item.size)}
        </p>
        <p className={failed ? 'upload-step field-error' : 'upload-step'} data-paused={item.paused || undefined}>
          {step}
        </p>
        {failed && item.failure?.code ? (
          <details className="details">
            <summary>{glossary.details}</summary>
            <code>{item.failure.code}</code>
          </details>
        ) : null}
        {failed || item.status === 'cancelled' ? null : (
          <progress
            className="upload-progress"
            max={1}
            value={processing(item) ? undefined : barValue(item)}
            aria-label={fill(cs.upload.progressLabel, { step, name: item.name })}
          />
        )}
      </div>
      <div className="row-actions">
        {finished ? null : (
          <button type="button" className="button" aria-label={fill(cs.upload.cancelFile, { name: item.name })} onClick={() => actions.cancel(item.id)}>
            {cs.upload.cancel}
          </button>
        )}
        {failed || item.status === 'cancelled' ? (
          <button type="button" className="button" aria-label={fill(cs.upload.retryFile, { name: item.name })} onClick={() => actions.retry(item.id)}>
            {glossary.retry}
          </button>
        ) : null}
        {finished ? (
          <button type="button" className="button" aria-label={fill(cs.upload.removeFile, { name: item.name })} onClick={() => actions.remove(item.id)}>
            {cs.upload.remove}
          </button>
        ) : null}
      </div>
    </li>
  );
}

/** "Nahráno 23 z 40 · zbývá asi 4 min", one bar, "Zrušit vše", "Zkusit znovu neúspěšné (n)". */
export function UploadSummary() {
  const actions = useUploadActions();
  const { queue, startedAt } = useUploadState();
  const { clock } = usePorts();
  const s = summarize(queue);
  const lastDone = [...queue.items].reverse().find((i) => i.status === 'done');
  return (
    <div className="upload-summary">
      <p className="upload-summary-text" role="status">
        {summaryText(queue, clock.now(), startedAt)}
      </p>
      <progress className="upload-progress" max={Math.max(s.total, 1)} value={s.done} aria-label={cs.upload.queueLabel} />
      <div className="header-actions">
        {s.active > 0 ? (
          <button type="button" className="button" onClick={actions.cancelAll}>
            {cs.upload.cancelAll}
          </button>
        ) : null}
        {s.failed > 0 ? (
          <button type="button" className="button button-primary" onClick={actions.retryFailed}>
            {fill(cs.upload.retryFailed, { count: s.failed })}
          </button>
        ) : null}
        {s.active === 0 && lastDone ? (
          <Link className="button" to={`/alba/${lastDone.albumId}`}>
            {cs.upload.showAlbum}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** Summary plus the file rows; shared by the drawer and the /nahravani page. `collapsed` keeps the summary line only. */
export function UploadQueueView({ collapsed = false }: { collapsed?: boolean }) {
  const actions = useUploadActions();
  const { queue, rejections } = useUploadState();
  const albums = useAlbums();
  const titles = new Map((albums.data ?? []).map((a) => [a.id, a.title] as const));
  return (
    <div className="upload-queue">
      {queue.items.length > 0 ? <UploadSummary /> : null}
      {collapsed ? null : rejections.length > 0 ? (
        <section className="notice notice-error" role="alert" aria-label={cs.upload.rejectedHeading}>
          <ul className="upload-rejected">
            {rejections.map((r) => (
              <li key={r.key}>
                <span>
                  <strong>{r.name}</strong>
                  {cs.upload.separator}
                  {r.message}
                </span>
                <button type="button" className="button" aria-label={fill(cs.upload.removeFile, { name: r.name })} onClick={() => actions.dismissRejection(r.key)}>
                  {cs.upload.remove}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {!collapsed && queue.items.length > 0 ? (
        <ul className="upload-rows" aria-label={cs.upload.filesLabel}>
          {queue.items.map((item) => (
            <FileRow key={item.id} item={item} albumTitle={titles.get(item.albumId)} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
