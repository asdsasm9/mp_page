import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useDocumentTitle } from '../components/Page';
import { cs } from '../i18n/cs';
import { ForgotPasswordForm } from './ForgotPasswordForm';
import { LoginForm } from './LoginForm';
import { RecoveryForm } from './RecoveryForm';
import { useSession } from './session';

/** Where to go after login: the page the guard sent the user away from, else the start page. */
export function returnPath(state: unknown): string {
  const from = state && typeof state === 'object' ? (state as { from?: unknown }).from : undefined;
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && from !== '/prihlaseni'
    ? from
    : '/';
}

/** /prihlaseni: sign-in, forgot password and set-new-password modes in one centred card. */
export function LoginPage() {
  const { status } = useSession();
  const location = useLocation();
  const [mode, setMode] = useState<'login' | 'forgot'>('login');

  const title =
    status === 'recovery' ? cs.login.recovery.title : mode === 'forgot' ? cs.login.forgot.title : cs.routes.login.title;
  useDocumentTitle(title);

  if (status === 'ready') return <Navigate to={returnPath(location.state)} replace />;

  return (
    <section className="card login-card">
      <h1>{title}</h1>
      {status === 'recovery' ? (
        <RecoveryForm />
      ) : status === 'loading' ? (
        <p role="status" className="page-note">
          {cs.session.checking}
        </p>
      ) : mode === 'forgot' ? (
        <ForgotPasswordForm onBack={() => setMode('login')} />
      ) : (
        <LoginForm onForgot={() => setMode('forgot')} />
      )}
    </section>
  );
}
