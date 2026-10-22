/** Footer of a dialog: action buttons plus a Cancel that does nothing while busy. */
import type { ReactNode } from 'react';
import { glossary } from '../i18n/cs';

interface ButtonProps {
  kind?: 'primary' | 'danger' | 'plain';
  type?: 'button' | 'submit';
  /** Busy: the button stays focusable (aria-disabled) but a click is ignored by the caller's guard. */
  busy: boolean;
  /** Also announce the busy state with aria-busy (confirm buttons). */
  announceBusy?: boolean;
  disabled?: boolean;
  autofocus?: boolean;
  onClick?: () => void;
  children: ReactNode;
}

export function DialogButton({ kind = 'plain', type = 'button', busy, announceBusy, disabled, autofocus, onClick, children }: ButtonProps) {
  return (
    <button
      type={type}
      className={kind === 'plain' ? 'button' : `button button-${kind}`}
      data-autofocus={autofocus ? '' : undefined}
      disabled={disabled}
      aria-disabled={busy || undefined}
      aria-busy={announceBusy ? busy : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

interface Props {
  busy: boolean;
  onClose: () => void;
  /** Cancel gets the initial focus (destructive dialogs). */
  cancelAutofocus?: boolean;
  /** The action buttons, shown before Cancel. */
  children?: ReactNode;
}

export function DialogActions({ busy, onClose, cancelAutofocus, children }: Props) {
  return (
    <div className="dialog-actions">
      {children}
      <DialogButton busy={busy} autofocus={cancelAutofocus} onClick={() => !busy && onClose()}>
        {glossary.cancel}
      </DialogButton>
    </div>
  );
}
