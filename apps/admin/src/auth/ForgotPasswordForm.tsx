import { useId, useRef, useState, type FormEvent } from 'react';
import { cs, glossary } from '../i18n/cs';
import { errorMessage } from '../i18n/messages';
import { usePorts } from '../ports-context';

interface Props {
  defaultEmail?: string;
  onBack: () => void;
}

/** Asks for a reset mail. The answer is the same whether or not the address exists. */
export function ForgotPasswordForm({ defaultEmail = '', onBack }: Props) {
  const { auth } = usePorts();
  const ids = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState(defaultEmail);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setFailure(null);
    setSent(false);
    if (email.trim() === '') {
      setEmailError(cs.login.emailRequired);
      emailRef.current?.focus();
      return;
    }
    setEmailError(null);
    setSubmitting(true);
    try {
      await auth.requestPasswordReset(email);
      setSent(true);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="form" noValidate onSubmit={onSubmit} aria-busy={submitting}>
      <p className="page-note">{cs.login.forgot.intro}</p>
      <div role="status">
        {sent ? <p className="notice notice-info">{cs.login.forgot.neutral}</p> : null}
      </div>
      {failure ? (
        <p className="notice notice-error" role="alert">
          {failure}
        </p>
      ) : null}
      <div className="field">
        <label htmlFor={`${ids}-email`}>{glossary.email}</label>
        <input
          ref={emailRef}
          id={`${ids}-email`}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={email}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? `${ids}-email-error` : undefined}
          onChange={(event) => setEmail(event.target.value)}
        />
        {emailError ? (
          <p id={`${ids}-email-error`} className="field-error">
            {emailError}
          </p>
        ) : null}
      </div>
      <button type="submit" className="button button-primary" aria-disabled={submitting || undefined}>
        {submitting ? cs.login.forgot.submitting : cs.login.forgot.submit}
      </button>
      <button type="button" className="button button-link" onClick={onBack}>
        {cs.login.forgot.back}
      </button>
    </form>
  );
}
