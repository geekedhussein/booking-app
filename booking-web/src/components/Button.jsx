import { Link } from 'react-router-dom';
import { Spinner } from './Feedback.jsx';

/**
 * variant: primary | secondary | ghost | danger
 * Renders a router Link when `to` is given, otherwise a button.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  block = false,
  to,
  children,
  className = '',
  disabled,
  ...rest
}) {
  const cls = `btn btn--${variant} btn--${size}${block ? ' btn--block' : ''} ${className}`.trim();
  if (to) {
    return (
      <Link to={to} className={cls} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <button className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Spinner size={16} />}
      <span className="btn__label">{children}</span>
    </button>
  );
}

export function IconButton({ label, children, className = '', ...rest }) {
  return (
    <button className={`icon-btn ${className}`} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}
