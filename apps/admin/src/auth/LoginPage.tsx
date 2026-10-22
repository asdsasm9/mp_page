import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useDocumentTitle } from '../components/Page';
import { cs } from '../i18n/cs';
import type { CallbackError } from '../ports';
import { usePorts } from '../ports-context';
import { GoogleSignIn } from './GoogleSignIn';
import { peekReturnPath, takeReturnPath } from './returnPath';
import { useSession } from './session';

/** Where to go after login: the page the guard sent the user away from, else the start page. */
export function returnPath(state: unknown): string {
  const from = state && typeof state === 'object' ? (state as { from?: unknown }).from : undefined;
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && from !== '/prihlaseni'
    ? from
    : '/';
}

const CALLBACK_TEXT: Record<CallbackError, string> = {
  NOT_ALLOWED: cs.login.google.notAllowed,
  CANCELLED: cs.login.google.cancelled,
  FAILED: cs.login.google.failed,
};

/**
 * Signed in: go back to the path stored before the Google redirect (it survives the page reload), else to the
 * page the guard turned away, else to the start page. The stored path is cleared once used.
 */
function ReturnNavigate({ state }: { state: unknown }) {
  const target = peekReturnPath() ?? returnPath(state);
  useEffect(() => {
    takeReturnPath();
  }, []);
  return <Navigate to={target} replace />;
}

/** /prihlaseni: one centred card with "Přihlásit se přes Google"; the callback of the round trip lands here too. */
export function LoginPage() {
  const { status, denied } = useSession();
  const { auth } = usePorts();
  const location = useLocation();
  const navigate = useNavigate();
  const [callbackNotice, setCallbackNotice] = useState<string | null>(null);
  useDocumentTitle(cs.routes.login.title);

  // The failure of the round trip we just came back from (read once; the adapter already cleaned the URL).
  useEffect(() => {
    const error = auth.takeCallbackError();
    if (error) setCallbackNotice(CALLBACK_TEXT[error]);
  }, [auth]);

  // A failed code exchange (other browser, lost verifier) leaves ?code= in the URL with no session: say so
  // generically and clean the address bar. While status is "loading" the code is still being exchanged.
  useEffect(() => {
    if (status !== 'signedOut') return;
    const params = new URLSearchParams(location.search);
    if (!params.has('code')) return;
    params.delete('code');
    if (!denied) setCallbackNotice((previous) => previous ?? cs.login.google.failed);
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }, { replace: true, state: location.state });
  }, [status, denied, location.pathname, location.search, location.hash, location.state, navigate]);

  if (status === 'ready') return <ReturnNavigate state={location.state} />;

  return (
    <section className="card login-card">
      <h1>{cs.login.google.title}</h1>
      {status === 'loading' ? (
        <p role="status" className="page-note">
          {cs.session.checking}
        </p>
      ) : (
        <>
          <p className="page-note">{cs.login.google.intro}</p>
          <GoogleSignIn returnTo={() => returnPath(location.state)} notice={callbackNotice} autoFocus showTip />
        </>
      )}
    </section>
  );
}
