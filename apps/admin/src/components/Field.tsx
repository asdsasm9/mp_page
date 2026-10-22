/** Labelled form field (input or textarea) with an error line and a hint, wired with aria-describedby. */
import { useId, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { cs } from '../i18n/cs';

export interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  error?: string | undefined;
  hint?: ReactNode;
  hintId?: string;
  multiline?: boolean;
  maxLength?: number;
  inputRef?: RefObject<HTMLInputElement>;
  /** Called with the control when it mounts and with null when it unmounts (to move focus there later). */
  onElement?: (element: HTMLInputElement | HTMLTextAreaElement | null) => void;
  autofocus?: boolean;
  autoCapitalize?: string;
  type?: 'text' | 'date';
  onBlur?: () => void;
  /** Enter in a single-line field (not in a textarea). */
  onEnter?: () => void;
}

export function Field({
  label,
  value,
  onChange,
  required,
  error,
  hint,
  hintId,
  multiline,
  maxLength,
  inputRef,
  onElement,
  autofocus,
  autoCapitalize,
  type = 'text',
  onBlur,
  onEnter,
}: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  const common = {
    id,
    value,
    maxLength,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    'data-autofocus': autofocus ? '' : undefined,
    onBlur,
  } as const;
  const setElement = (element: HTMLInputElement | HTMLTextAreaElement | null) => {
    if (inputRef && element instanceof HTMLInputElement) {
      (inputRef as { current: HTMLInputElement | null }).current = element;
    }
    onElement?.(element);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (onEnter && event.key === 'Enter') {
      event.preventDefault();
      onEnter();
    }
  };
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? <span className="required"> {cs.categories.required}</span> : null}
      </label>
      {multiline ? (
        <textarea {...common} ref={setElement} rows={3} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input
          {...common}
          ref={setElement}
          type={type}
          autoCapitalize={autoCapitalize}
          spellCheck={false}
          onKeyDown={onKeyDown}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {error ? (
        <p id={errorId} className="field-error">
          {error}
        </p>
      ) : null}
      {hint ? (
        <div id={hintId} className="field-hint">
          {hint}
        </div>
      ) : null}
    </div>
  );
}
