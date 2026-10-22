import { Modal } from '../components/Modal';
import { cs, glossary } from '../i18n/cs';
import { GoogleSignIn } from './GoogleSignIn';
import { useSession } from './session';

function Dialog() {
  const { session, signOut } = useSession();

  return (
    // Escape must not dismiss it: the work behind waits for a login.
    <Modal title={cs.login.expired.title} onClose={() => {}} dismissible={false}>
      <p className="page-note">{cs.login.expired.body}</p>
      {/* This component sits above the router, so the current address comes from the window. */}
      <GoogleSignIn
        returnTo={() => `${window.location.pathname}${window.location.search}`}
        {...(session?.email ? { loginHint: session.email } : {})}
      />
      <button type="button" className="button button-link" onClick={() => void signOut()}>
        {glossary.logOut}
      </button>
    </Modal>
  );
}

/** "Přihlášení vypršelo": over the running app; Google sign-in reloads the page, so unsaved work is lost (the text says so). */
export function ExpiredDialog() {
  const { status } = useSession();
  return status === 'expired' ? <Dialog /> : null;
}
