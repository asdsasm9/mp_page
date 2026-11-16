/** Dialogs of the Instagram post editor (WP-14): the posted date (default today), the unmark confirm and the delete confirmation. */
import { useId, useState } from 'react';
import { DialogActions, DialogButton } from '../components/DialogActions';
import { Field } from '../components/Field';
import { Modal } from '../components/Modal';
import { Notice } from '../components/Notice';
import { useConfirmAction } from '../components/useConfirmAction';
import { useCanMutate } from '../data/health';
import { cs, glossary } from '../i18n/cs';
import { errorMessage } from '../i18n/messages';

/** Today as YYYY-MM-DD in the browser's own calendar (the date the photographer sees on her phone). */
export function todayLocal(now: Date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

/** A calendar day as an ISO instant at noon local time (the day stays the same in every nearby zone). */
export function postedAtFromDate(date: string): string {
  return new Date(`${date}T12:00:00`).toISOString();
}

interface MarkProps {
  onClose: () => void;
  /** Saves; resolves when done (the caller closes the dialog) or rejects with the failure. */
  onConfirm: (postedAt: string) => Promise<void>;
}

export function MarkPostedDialog({ onClose, onConfirm }: MarkProps) {
  const hintId = useId();
  const canMutate = useCanMutate();
  const [date, setDate] = useState(() => todayLocal());
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const t = cs.instagram.markDialog;

  const { saving, failure, confirm } = useConfirmAction(async () => {
    await onConfirm(postedAtFromDate(date));
  });

  function submit() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setProblem(t.dateRequired);
      return;
    }
    if (date > todayLocal()) {
      setProblem(t.dateFuture);
      return;
    }
    setProblem(undefined);
    void confirm();
  }

  return (
    <Modal title={t.title} onClose={onClose} busy={saving}>
      <div className="form">
        <Field
          label={t.dateLabel}
          type="date"
          value={date}
          onChange={(value) => {
            setDate(value);
            setProblem(undefined);
          }}
          required
          error={problem}
          hint={t.hint}
          hintId={hintId}
          autofocus
          onEnter={submit}
        />
        {failure === null ? null : <Notice>{errorMessage(failure)}</Notice>}
        <DialogActions busy={saving} onClose={onClose}>
          <DialogButton kind="primary" busy={saving} announceBusy disabled={!canMutate} onClick={submit}>
            {saving ? t.saving : t.confirm}
          </DialogButton>
        </DialogActions>
      </div>
    </Modal>
  );
}

interface UnmarkProps {
  /** The status the person chose: Koncept saves the post as a draft after it is taken out of the posted block. */
  target: 'draft' | 'planned';
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

/** Short confirm before a posted post goes back to the plan (plan 3.6: last in the planned block, date cleared). */
export function UnmarkPostedDialog({ target, onClose, onConfirm }: UnmarkProps) {
  const canMutate = useCanMutate();
  const t = cs.instagram.unmarkDialog;
  const { saving, failure, confirm } = useConfirmAction(onConfirm);
  return (
    <Modal title={t.title} onClose={onClose} busy={saving}>
      <p>{target === 'draft' ? t.bodyDraft : t.bodyPlanned}</p>
      {failure === null ? null : <Notice>{errorMessage(failure)}</Notice>}
      <DialogActions busy={saving} onClose={onClose} cancelAutofocus>
        <DialogButton kind="primary" busy={saving} announceBusy disabled={!canMutate} onClick={() => void confirm()}>
          {saving ? t.saving : t.confirm}
        </DialogButton>
      </DialogActions>
    </Modal>
  );
}

interface DeleteProps {
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function DeletePostDialog({ onClose, onConfirm }: DeleteProps) {
  const canMutate = useCanMutate();
  const t = cs.instagram.deleteDialog;
  const { saving, failure, confirm } = useConfirmAction(onConfirm);
  return (
    <Modal title={t.title} onClose={onClose} busy={saving}>
      <p>{t.body}</p>
      {failure === null ? null : <Notice>{errorMessage(failure)}</Notice>}
      <DialogActions busy={saving} onClose={onClose} cancelAutofocus>
        <DialogButton kind="danger" busy={saving} announceBusy disabled={!canMutate} onClick={() => void confirm()}>
          {saving ? t.deleting : glossary.delete}
        </DialogButton>
      </DialogActions>
    </Modal>
  );
}
