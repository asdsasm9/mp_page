import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { LoadFailure } from '../components/LoadFailure';
import { cs } from '../i18n/cs';
import { useSession } from './session';

/**
 * Route guard. Children (and with them every data hook) render only while the session is ready or has just
 * expired (the modal covers the page and keeps its state). Anything else: no children, so no data call.
 */
export function RequireAuth() {
  const { status, error, retry } = useSession();
  const location = useLocation();

  if (status === 'ready' || status === 'expired') return <Outlet />;
  if (status === 'loading') {
    return (
      <main className="auth-main">
        <p role="status" className="page-note">
          {cs.session.checking}
        </p>
      </main>
    );
  }
  if (status === 'error') {
    return (
      <main className="auth-main">
        <LoadFailure error={error} message={cs.session.checkFailed} onRetry={retry} />
      </main>
    );
  }
  // signedOut: the login page takes over. `from` is what the Google button stores in
  // sessionStorage before leaving the page, so the path survives the full-page redirect and is restored afterwards.
  return <Navigate to="/prihlaseni" replace state={{ from: `${location.pathname}${location.search}` }} />;
}
