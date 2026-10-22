import { useEffect, useRef, useState } from 'react';
import { cs } from '../i18n/cs';
import { errorMessage } from '../i18n/messages';
import { useSession } from './session';

interface Props {
  /** App path to come back to after Google; read at click time. */
  returnTo: () => string;
  /** Pre-selects the account at Google (expiry re-sign-in). */
  loginHint?: string;
  /** A notice that came from outside (a failed callback), shown until the next attempt. */
  notice?: string | null;
  /** Put keyboard focus on the button when it appears (the login page; a dialog does this itself). */
  autoFocus?: boolean;
  /** The two-step verification tip under the button (the login card only). */
  showTip?: boolean;
}

/**
 * "Přihlásit se přes Google": the button, its busy state and every failure notice (role="alert").
 * With the real adapter the page is left on click and the busy text stays; with the fake one the promise resolves.
 * The button uses aria-disabled while busy so it keeps keyboard focus.
 */
export function GoogleSignIn({ returnTo, loginHint, notice = null, autoFocus = false, showTip = false }: Props) {
  const { signInWithGoogle, denied } = useSession();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<string | null>(null);

  useEffect(() => {
    if (autoFocus) buttonRef.current?.focus();
  }, [autoFocus]);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    setLocal(null);
    try {
      const result = await signInWithGoogle({ returnTo: returnTo(), ...(loginHint ? { loginHint } : {}) });
      if (result === 'cancelled') setLocal(cs.login.google.cancelled);
      else if (result === 'failed') setLocal(cs.login.google.failed);
    } catch (error) {
      setLocal(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const message = local ?? (denied ? cs.login.google.notAllowed : notice);

  return (
    <div className="form">
      {message ? (
        <p className="notice notice-error" role="alert">
          {message}
        </p>
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        className="button button-primary"
        data-autofocus
        aria-disabled={busy || undefined}
        onClick={() => void onClick()}
      >
        {busy ? cs.login.google.busy : cs.login.google.button}
      </button>
      {showTip ? <p className="page-note">{cs.login.google.tip}</p> : null}
    </div>
  );
}
