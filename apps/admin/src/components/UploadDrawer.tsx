import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { hasSeenLaptopHint, isPhoneViewport, markLaptopHintSeen } from '../upload/laptopHint';
import { cs } from '../i18n/cs';
import { fill } from '../i18n/format';
import { summarize } from '../upload/reducer';
import { useUploadActions, useUploadState } from '../upload/UploadProvider';
import { Modal } from './Modal';
import { UploadQueueView } from './UploadQueueView';

export const UPLOAD_PATH = '/nahravani';

/**
 * T-246: indicator fixed at the bottom right, only while something uploads (or needs attention: a failed or rejected
 * file). Shows "Nahráno 3 z 10", opens the queue panel. The wrapper is the polite live region and is always mounted
 * (and empty when idle) so screen readers announce the count changes.
 */
export function UploadIndicator() {
  const actions = useUploadActions();
  const { queue, rejections, drawerOpen } = useUploadState();
  const { pathname } = useLocation();
  const s = summarize(queue);
  const attention = s.active > 0 || s.failed > 0 || rejections.length > 0;
  const shown = attention && !drawerOpen && pathname !== UPLOAD_PATH; // the panel and the page show the queue themselves
  const text = [
    fill(cs.upload.summary, { done: s.done, total: s.total }),
    ...(s.failed > 0 ? [fill(cs.upload.indicatorFailed, { failed: s.failed })] : []),
  ].join(cs.upload.separator);
  return (
    <div className="upload-pill-region" aria-live="polite">
      {shown ? (
        <button
          type="button"
          className="button upload-pill"
          aria-label={`${cs.upload.indicatorOpen}: ${text}`}
          onClick={() => actions.setDrawerOpen(true)}
        >
          {text}
        </button>
      ) : null}
    </div>
  );
}

/** One-time phone hint: decided when the open sheet first mounts, then remembered so it never returns. */
export function LaptopHint() {
  const [visible, setVisible] = useState(() => isPhoneViewport() && !hasSeenLaptopHint());
  useEffect(() => {
    if (visible) markLaptopHintSeen();
  }, [visible]);
  if (!visible) return null;
  return (
    <div className="notice upload-hint" role="note">
      <p>{cs.upload.laptopHint}</p>
      <button type="button" className="button" onClick={() => setVisible(false)}>
        {cs.upload.laptopHintDismiss}
      </button>
    </div>
  );
}

/** The queue panel docked at the bottom right; a full-height sheet on a phone. Shown only while open (the indicator opens it), hidden on /nahravani. */
export function UploadDrawer() {
  const actions = useUploadActions();
  const { queue, rejections, drawerOpen } = useUploadState();
  const { pathname } = useLocation();
  if (!drawerOpen) return null;
  if (queue.items.length === 0 && rejections.length === 0) return null;
  if (pathname === UPLOAD_PATH) return null;
  return (
    <aside id="upload-drawer" className="upload-drawer" aria-label={cs.upload.queueLabel}>
      <div className="upload-drawer-head">
        <h2>{cs.upload.queueLabel}</h2>
        <button type="button" className="button" onClick={() => actions.setDrawerOpen(false)}>
          {cs.upload.collapse}
        </button>
      </div>
      <div id="upload-drawer-body">
        <LaptopHint />
        <UploadQueueView />
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
