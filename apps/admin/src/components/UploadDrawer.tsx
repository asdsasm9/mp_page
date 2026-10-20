import { useLocation } from 'react-router-dom';
import { cs } from '../i18n/cs';
import { fill } from '../i18n/format';
import { summarize } from '../upload/reducer';
import { useUploadActions, useUploadState } from '../upload/UploadProvider';
import { Modal } from './Modal';
import { UploadQueueView } from './UploadQueueView';

export const UPLOAD_PATH = '/nahravani';

/** Top-bar button with the number of running and failed files; it opens and closes the drawer. */
export function UploadIndicator() {
  const actions = useUploadActions();
  const { queue, rejections, drawerOpen } = useUploadState();
  const { pathname } = useLocation();
  const s = summarize(queue);
  if (queue.items.length === 0 && rejections.length === 0) return null;
  if (pathname === UPLOAD_PATH) return null; // the page itself shows the queue
  const text = [
    fill(cs.upload.indicator, { active: s.active }),
    ...(s.failed > 0 ? [fill(cs.upload.indicatorFailed, { failed: s.failed })] : []),
  ].join(cs.upload.separator);
  return (
    <button
      type="button"
      className="button upload-indicator"
      aria-expanded={drawerOpen}
      aria-controls="upload-drawer"
      onClick={() => actions.setDrawerOpen(!drawerOpen)}
    >
      {text}
    </button>
  );
}

/** The queue docked at the bottom right (full width on a phone); collapsible, hidden on /nahravani. */
export function UploadDrawer() {
  const actions = useUploadActions();
  const { queue, rejections, drawerOpen } = useUploadState();
  const { pathname } = useLocation();
  if (queue.items.length === 0 && rejections.length === 0) return null;
  if (pathname === UPLOAD_PATH) return null;
  return (
    <aside id="upload-drawer" className="upload-drawer" aria-label={cs.upload.queueLabel} data-collapsed={!drawerOpen || undefined}>
      <div className="upload-drawer-head">
        <h2>{cs.upload.queueLabel}</h2>
        <button
          type="button"
          className="button"
          aria-expanded={drawerOpen}
          aria-controls="upload-drawer-body"
          onClick={() => actions.setDrawerOpen(!drawerOpen)}
        >
          {drawerOpen ? cs.upload.collapse : cs.upload.expand}
        </button>
      </div>
      <div id="upload-drawer-body">
        <UploadQueueView collapsed={!drawerOpen} />
      </div>
    </aside>
  );
}

/** "Tato fotka už v albu je. Přeskočit / Nahrát znovu": skipping is the default (Escape and the first button). */
export function UploadDuplicateDialog() {
  const actions = useUploadActions();
  const { duplicates } = useUploadState();
  if (!duplicates) return null;
  const files = duplicates.files;
  return (
    <Modal title={files.length === 1 ? cs.upload.duplicateOne : fill(cs.upload.duplicateMany, { count: files.length })} onClose={() => actions.resolveDuplicates(false)}>
      <ul className="upload-rejected">
        {files.map((file, i) => (
          <li key={`${file.name}-${i}`}>{file.name}</li>
        ))}
      </ul>
      <div className="dialog-actions">
        <button type="button" className="button button-primary" data-autofocus="" onClick={() => actions.resolveDuplicates(false)}>
          {cs.upload.duplicateSkip}
        </button>
        <button type="button" className="button" onClick={() => actions.resolveDuplicates(true)}>
          {cs.upload.duplicateAgain}
        </button>
      </div>
    </Modal>
  );
}
