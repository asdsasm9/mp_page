/**
 * "Nahradit lepší verzí" in the photo detail (WP-10 step 8, D-21 option A): pick a file, check it like any upload, show
 * before and after in a confirmation dialog, then upload it as a new photo of the same album and swap it in
 * (copy sort/alt/caption, move the cover, delete the old photo; see data/photoReplace.ts). A failure after the new
 * photo exists leaves both photos and offers "Dokončit" / "Zrušit".
 */
import type { AlbumRow, PhotoRow } from '@mp/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCanMutate } from '../data/health';
import { ReplaceStepError, usePhotoReplace, type ReplaceStep, type ReplaceTarget } from '../data/photoReplace';
import { cs, glossary } from '../i18n/cs';
import { fill, formatBytes } from '../i18n/format';
import { errorMessage } from '../i18n/messages';
import { PICKER_ACCEPT } from '../upload/intake';
import { stepLabel } from '../upload/summary';
import { useUploadActions, useUploadState } from '../upload/UploadProvider';
import { DialogActions, DialogButton } from './DialogActions';
import { Modal } from './Modal';
import { Notice } from './Notice';
import { useToast } from './Toast';

const t = cs.photos.replace;

type Phase =
  | { kind: 'idle' }
  | { kind: 'confirm'; file: File; width: number | null; height: number | null }
  | { kind: 'running'; step: 'upload' | ReplaceStep; itemId: string | null }
  | { kind: 'uploadFailed'; file: File; message: string }
  | { kind: 'incomplete'; target: ReplaceTarget; from: ReplaceStep; message: string };

const STEP_TEXT: Record<ReplaceStep | 'upload', string> = {
  upload: t.stepUpload,
  copy: t.stepCopy,
  cover: t.stepCover,
  delete: t.stepDelete,
};

/** Text of a failure that is either an Error (Worker, network) or the queue's plain ItemFailure. */
function failureText(error: unknown): string {
  if (error !== null && typeof error === 'object' && !(error instanceof Error) && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return errorMessage(error);
}

/** Moves focus to the new content of the dialog when the step changes (the focused button just disappeared). */
function Stage({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div ref={ref} tabIndex={-1} className="replace-stage" aria-label={label}>
      {children}
    </div>
  );
}

function Facts({ heading, rows }: { heading: string; rows: Array<[string, string]> }) {
  return (
    <section className="replace-facts">
      <h3>{heading}</h3>
      <dl className="quality-list">
        {rows.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

interface Props {
  album: AlbumRow;
  photo: PhotoRow;
  /** Saves an edited alt/caption draft first; false = stay (the replacement would copy stale texts). */
  beforeStart: () => Promise<boolean>;
}

export function ReplacePhoto({ album, photo, beforeStart }: Props) {
  const actions = useUploadActions();
  const { queue } = useUploadState();
  const { finish } = usePhotoReplace();
  const canMutate = useCanMutate();
  const toast = useToast();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [rejected, setRejected] = useState<string | null>(null);

  const close = () => setPhase({ kind: 'idle' });

  async function choose(file: File | undefined) {
    if (!file) return;
    setRejected(null);
    if (!(await beforeStart())) return;
    const check = await actions.checkReplacement(file);
    if (!check.ok) {
      setRejected(check.message); // nothing was queued, uploaded or changed
      return;
    }
    setPhase({ kind: 'confirm', file, width: check.dimensions?.width ?? null, height: check.dimensions?.height ?? null });
  }

  /** Steps 2 to 4, from `from`; also what "Dokončit" repeats. */
  async function swap(target: ReplaceTarget, from: ReplaceStep) {
    setPhase({ kind: 'running', step: from, itemId: null });
    try {
      await finish(target, from, (step) => setPhase({ kind: 'running', step, itemId: null }));
    } catch (error) {
      const step = error instanceof ReplaceStepError ? error.step : from;
      const cause = error instanceof ReplaceStepError ? error.cause : error;
      setPhase({ kind: 'incomplete', target, from: step, message: failureText(cause) });
      return;
    }
    close();
    toast.show(t.done);
    navigate(`/alba/${target.albumId}/foto/${target.newId}`);
  }

  async function replace(file: File) {
    cancelled.current = false;
    const job = actions.startReplacement(album.id, file);
    if (!job) {
      setPhase({ kind: 'uploadFailed', file, message: cs.upload.corrupt });
      return;
    }
    setPhase({ kind: 'running', step: 'upload', itemId: job.id });
    let added: PhotoRow;
    try {
      added = await job.done;
    } catch (error) {
      if (cancelled.current) close();
      else setPhase({ kind: 'uploadFailed', file, message: failureText(error) });
      return;
    }
    await swap({ albumId: album.id, oldId: photo.id, newId: added.id }, 'copy');
  }

  const item = phase.kind === 'running' && phase.itemId ? queue.items.find((i) => i.id === phase.itemId) : undefined;
  const running = phase.kind === 'running';

  let title: string = t.title;
  if (phase.kind === 'uploadFailed') title = t.uploadFailedTitle;
  if (phase.kind === 'incomplete') title = t.incompleteTitle;

  return (
    <section className="replace-photo" aria-labelledby="replace-heading">
      <h2 id="replace-heading" className="visually-hidden">
        {t.button}
      </h2>
      <button type="button" className="button" disabled={!canMutate || phase.kind !== 'idle'} onClick={() => inputRef.current?.click()}>
        {t.button}
      </button>
      <p className="field-hint">{t.pickHint}</p>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={PICKER_ACCEPT}
        aria-label={t.pickLabel}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = ''; // the same file can be picked again
          void choose(file);
        }}
      />
      {rejected === null ? null : (
        <Notice as="div">
          <p>
            <strong>{t.rejectedHeading}.</strong> {rejected}
          </p>
        </Notice>
      )}
      {phase.kind === 'idle' ? null : (
        <Modal title={title} busy={running} onClose={close}>
          {phase.kind === 'confirm' ? (
            <Stage label={t.title}>
              <p>{t.intro}</p>
              <div className="replace-compare">
                <Facts
                  heading={t.before}
                  rows={[
                    [t.resolution, fill(cs.quality.pixels, { w: photo.width, h: photo.height })],
                    [t.size, formatBytes(photo.variants.master.bytes)],
                  ]}
                />
                <Facts
                  heading={t.after}
                  rows={[
                    [t.fileName, phase.file.name],
                    [t.resolution, phase.width && phase.height ? fill(cs.quality.pixels, { w: phase.width, h: phase.height }) : t.unknown],
                    [t.size, formatBytes(phase.file.size)],
                  ]}
                />
              </div>
              {phase.width && phase.height && Math.max(phase.width, phase.height) <= Math.max(photo.width, photo.height) ? (
                <Notice variant="info">{t.noGain}</Notice>
              ) : null}
              <DialogActions busy={false} onClose={close}>
                <DialogButton kind="primary" busy={false} autofocus onClick={() => void replace(phase.file)}>
                  {t.confirm}
                </DialogButton>
              </DialogActions>
            </Stage>
          ) : null}
          {phase.kind === 'running' ? (
            <Stage label={t.progressLabel}>
              <p role="status">{item && phase.step === 'upload' ? stepLabel(item) : STEP_TEXT[phase.step]}</p>
              <progress
                className="upload-progress"
                max={1}
                value={item?.status === 'uploading' ? item.progress : undefined}
                aria-label={`${t.progressLabel}: ${STEP_TEXT[phase.step]}`}
              />
              {phase.step === 'upload' ? (
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      cancelled.current = true;
                      if (phase.itemId) actions.cancel(phase.itemId);
                    }}
                  >
                    {glossary.cancel}
                  </button>
                </div>
              ) : null}
            </Stage>
          ) : null}
          {phase.kind === 'uploadFailed' ? (
            <Stage label={t.uploadFailedTitle}>
              <Notice as="div">
                <p>{phase.message}</p>
                <p>{t.uploadFailedBody}</p>
              </Notice>
              <DialogActions busy={false} onClose={close}>
                <DialogButton kind="primary" busy={false} onClick={() => void replace(phase.file)}>
                  {glossary.retry}
                </DialogButton>
              </DialogActions>
            </Stage>
          ) : null}
          {phase.kind === 'incomplete' ? (
            <Stage label={t.incompleteTitle}>
              <Notice as="div">
                <p>{t.incompleteBody}</p>
                <p>{phase.message}</p>
              </Notice>
              <div className="dialog-actions">
                <DialogButton kind="primary" busy={false} onClick={() => void swap(phase.target, phase.from)}>
                  {t.finish}
                </DialogButton>
                <DialogButton
                  busy={false}
                  onClick={() => {
                    close();
                    toast.show(t.keptBoth);
                  }}
                >
                  {glossary.cancel}
                </DialogButton>
              </div>
            </Stage>
          ) : null}
        </Modal>
      )}
    </section>
  );
}
