import { useEffect, useRef } from 'react';
import { Modal } from '../components/Modal';
import { cs, glossary } from '../i18n/cs';
import { LoginForm } from './LoginForm';
import { useSession } from './session';

function Dialog() {
  const { session, signOut } = useSession();
  const ref = useRef<HTMLDivElement>(null);
  const hasEmail = !!session?.email;

  useEffect(() => {
    // Modal focuses the first field once open; the address is known, so the cursor goes to the password
    // (this effect runs after Modal's own).
    if (hasEmail) ref.current?.querySelector<HTMLInputElement>('input[type="password"]')?.focus();
    // Opening happens once; later changes of the session must not move focus.
  }, []);

  return (
    // Escape must not dismiss it: the work behind waits for a login.
    <Modal title={cs.login.expired.title} onClose={() => {}} dismissible={false}>
      <div ref={ref}>
        <p className="page-note">{cs.login.expired.body}</p>
        <LoginForm defaultEmail={session?.email ?? ''} />
        <button type="button" className="button button-link" onClick={() => void signOut()}>
          {glossary.logOut}
        </button>
      </div>
    </Modal>
  );
}

/** "Přihlášení vypršelo": over the running app, which keeps its state; after login the waiting calls are repeated. */
export function ExpiredDialog() {
  const { status } = useSession();
  return status === 'expired' ? <Dialog /> : null;
}
