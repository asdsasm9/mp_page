import { useId, useRef, useState, type FormEvent } from 'react';
import { cs, glossary } from '../i18n/cs';
import { errorMessage, messageForCode } from '../i18n/messages';
import { PasswordField } from './PasswordField';
import { useSession } from './session';

interface Props {
  defaultEmail?: string;
  onForgot?: () => void;
}

/**
 * E-mail + password form with every state of ADMIN-UX 3.1. Used by the login page and the expiry modal.
 * Sign-in success is not handled here: the session context changes status and the screen reacts.
 */
export function LoginForm({ defaultEmail = '', onForgot }: Props) {
  const { signIn, denied } = useSession();
  const ids = useId();
  const emailId = `${ids}-email`;
  const passwordId = `${ids}-password`;
  const emailErrorId = `${ids}-email-error`;
  const passwordErrorId = `${ids}-password-error`;
  const formErrorId = `${ids}-form-error`;
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [localDenied, setLocalDenied] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const errors: { email?: string; password?: string } = {};
    if (email.trim() === '') errors.email = cs.login.emailRequired;
    if (password === '') errors.password = cs.login.passwordRequired;
    setFieldErrors(errors);
    setFailure(null);
    setLocalDenied(false);
    if (errors.email) return emailRef.current?.focus();
    if (errors.password) return passwordRef.current?.focus();

    setSubmitting(true);
    try {
      const result = await signIn(email, password);
      if (result === 'denied') setLocalDenied(true);
    } catch (error) {
      setFailure(errorMessage(error));
      setPassword('');
      passwordRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  const message = failure ?? (localDenied || denied ? messageForCode('NOT_ADMIN') : null);

  return (
    <form className="form" noValidate onSubmit={onSubmit} aria-busy={submitting}>
      {message ? (
        <p id={formErrorId} className="notice notice-error" role="alert">
          {message}
        </p>
      ) : null}
      <div className="field">
        <label htmlFor={emailId}>{glossary.email}</label>
        <input
          ref={emailRef}
          id={emailId}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={email}
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={fieldErrors.email ? emailErrorId : undefined}
          onChange={(event) => setEmail(event.target.value)}
        />
        {fieldErrors.email ? (
          <p id={emailErrorId} className="field-error">
            {fieldErrors.email}
          </p>
        ) : null}
      </div>
      <div>
        <PasswordField
          ref={passwordRef}
          id={passwordId}
          label={cs.login.password}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          invalid={!!fieldErrors.password}
          describedBy={fieldErrors.password ? passwordErrorId : undefined}
        />
        {fieldErrors.password ? (
          <p id={passwordErrorId} className="field-error">
            {fieldErrors.password}
          </p>
        ) : null}
      </div>
      <button type="submit" className="button button-primary" aria-disabled={submitting || undefined}>
        {submitting ? cs.login.submitting : cs.login.submit}
      </button>
      {onForgot ? (
        <button type="button" className="button button-link" onClick={onForgot}>
          {cs.login.forgotPassword}
        </button>
      ) : null}
    </form>
  );
}
