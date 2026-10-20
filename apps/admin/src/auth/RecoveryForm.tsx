import { useId, useRef, useState, type FormEvent } from 'react';
import { cs } from '../i18n/cs';
import { errorMessage } from '../i18n/messages';
import { PasswordField } from './PasswordField';
import { useSession } from './session';

const MIN_LENGTH = 8;

/** Set-new-password mode: the user came through the link in the reset mail and holds a recovery session. */
export function RecoveryForm() {
  const { completeRecovery } = useSession();
  const ids = useId();
  const firstRef = useRef<HTMLInputElement>(null);
  const secondRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<{ first?: string; second?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const next: { first?: string; second?: string } = {};
    if (password.length < MIN_LENGTH) next.first = cs.login.recovery.tooShort;
    else if (repeat !== password) next.second = cs.login.recovery.mismatch;
    setErrors(next);
    setFailure(null);
    if (next.first) return firstRef.current?.focus();
    if (next.second) return secondRef.current?.focus();

    setSubmitting(true);
    try {
      await completeRecovery(password);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  const hintId = `${ids}-hint`;
  return (
    <form className="form" noValidate onSubmit={onSubmit} aria-busy={submitting}>
      <p className="page-note">{cs.login.recovery.intro}</p>
      {failure ? (
        <p className="notice notice-error" role="alert">
          {failure}
        </p>
      ) : null}
      <div>
        <PasswordField
          ref={firstRef}
          id={`${ids}-new`}
          label={cs.login.recovery.newPassword}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          invalid={!!errors.first}
          describedBy={errors.first ? `${ids}-new-error ${hintId}` : hintId}
        />
        <p id={hintId} className="field-hint">
          {cs.login.recovery.hint}
        </p>
        {errors.first ? (
          <p id={`${ids}-new-error`} className="field-error">
            {errors.first}
          </p>
        ) : null}
      </div>
      <div>
        <PasswordField
          ref={secondRef}
          id={`${ids}-repeat`}
          label={cs.login.recovery.repeat}
          value={repeat}
          onChange={setRepeat}
          autoComplete="new-password"
          invalid={!!errors.second}
          describedBy={errors.second ? `${ids}-repeat-error` : undefined}
          toggle={false}
        />
        {errors.second ? (
          <p id={`${ids}-repeat-error`} className="field-error">
            {errors.second}
          </p>
        ) : null}
      </div>
      <button type="submit" className="button button-primary" disabled={submitting}>
        {submitting ? cs.login.recovery.submitting : cs.login.recovery.submit}
      </button>
    </form>
  );
}
