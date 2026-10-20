import { forwardRef, useState, type Ref } from 'react';
import { cs } from '../i18n/cs';

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  describedBy?: string | undefined;
  invalid?: boolean;
  /** Hint under the label, already linked through describedBy by the caller. */
  disabled?: boolean;
  /** Show-password toggle. Off for the second field of a pair. */
  toggle?: boolean;
}

/** A password input with an optional "Zobrazit heslo" toggle. Paste and password managers are never blocked. */
export const PasswordField = forwardRef(function PasswordField(
  { id, label, value, onChange, autoComplete, describedBy, invalid, disabled, toggle = true }: Props,
  ref: Ref<HTMLInputElement>,
) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field-row">
        <input
          ref={ref}
          id={id}
          name={autoComplete === 'new-password' ? 'new-password' : 'password'}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          required
          value={value}
          disabled={disabled}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
        {toggle ? (
          <button type="button" className="button" aria-controls={id} onClick={() => setVisible((v) => !v)}>
            {visible ? cs.login.hidePassword : cs.login.showPassword}
          </button>
        ) : null}
      </div>
    </div>
  );
});
