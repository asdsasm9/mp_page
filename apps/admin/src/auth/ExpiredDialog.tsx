import { useEffect, useId, useRef } from 'react';
import { cs, glossary } from '../i18n/cs';
import { LoginForm } from './LoginForm';
import { useSession } from './session';

function Dialog() {
  const { session, signOut } = useSession();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const hasEmail = !!session?.email;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Native modal: focus is trapped, the page behind is inert. jsdom has no showModal.
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    // The address is known, so the cursor goes to the password (only possible once the dialog is open).
    if (hasEmail) dialog.querySelector<HTMLInputElement>('input[type="password"]')?.focus();
    return () => {
      // close() hands focus back to the element that had it before the modal opened.
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    };
    // Opening happens once; later changes of the session must not move focus.
  }, []);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      // Escape must not dismiss it: the work behind waits for a login.
      onCancel={(event) => event.preventDefault()}
    >
      <h2 id={titleId}>{cs.login.expired.title}</h2>
      <p className="page-note">{cs.login.expired.body}</p>
      <LoginForm defaultEmail={session?.email ?? ''} />
      <button type="button" className="button button-link" onClick={() => void signOut()}>
        {glossary.logOut}
      </button>
    </dialog>
  );
}

/** "Přihlášení vypršelo": over the running app, which keeps its state; after login the waiting calls are repeated. */
export function ExpiredDialog() {
  const { status } = useSession();
  return status === 'expired' ? <Dialog /> : null;
}
