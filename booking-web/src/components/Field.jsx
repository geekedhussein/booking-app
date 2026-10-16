import { useId } from 'react';

/** Label + control + hint/error, wired up with ids for screen readers. */
export function Field({ label, hint, error, children, className = '' }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${error ? 'field--error' : ''} ${className}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && !error && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField({ label, hint, error, className, ...inputProps }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(a11y) => <input className="input" {...a11y} {...inputProps} />}
    </Field>
  );
}

export function SelectField({ label, hint, error, className, children, ...selectProps }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(a11y) => (
        <select className="input select" {...a11y} {...selectProps}>
          {children}
        </select>
      )}
    </Field>
  );
}
