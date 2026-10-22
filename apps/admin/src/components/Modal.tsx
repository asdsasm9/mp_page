import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  /** Escape and the close paths call this; ignored while `busy`. */
  onClose: () => void;
  busy?: boolean;
  /** `false`: Escape and the native cancel are ignored (e.g. a login that must be completed). Default true. */
  dismissible?: boolean;
  /** `sheet`: a bottom sheet on a phone, a normal dialog from 640 px. */
  variant?: 'sheet';
  children: ReactNode;
}

const FOCUSABLE = 'input, textarea, select, button, a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog on the native <dialog>: showModal() traps focus and makes the page behind inert; Escape asks
 * onClose; when it unmounts, focus returns to the element that opened it (done explicitly so it also holds
 * where showModal is missing, as in jsdom). The first field (or `[data-autofocus]`) receives focus.
 */
export function Modal({ title, onClose, busy = false, dismissible = true, variant, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy || !dismissible;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    const target = dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
    return () => {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      // The opener can be gone (the row it belonged to was created, moved or deleted): the main region then
      // takes focus, so keyboard users never start again from the top of the page.
      if (opener?.isConnected && opener !== document.body) opener.focus();
      else document.querySelector<HTMLElement>('main')?.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={variant === 'sheet' ? 'dialog dialog-sheet' : 'dialog'}
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      onKeyDown={(event) => {
        // Where the native cancel event does not fire (jsdom) Escape still closes.
        if (event.key === 'Escape') {
          event.preventDefault();
          if (!busyRef.current) closeRef.current();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busyRef.current) closeRef.current();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}
