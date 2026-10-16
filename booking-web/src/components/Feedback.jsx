import { Icon } from './Icon.jsx';

export function Spinner({ size = 20 }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

export function PageLoader({ label = 'Loading' }) {
  return (
    <div className="page-loader" role="status">
      <Spinner size={28} />
      <span className="visually-hidden">{label}</span>
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="empty">
      <h3 className="empty__title">{title}</h3>
      {children && <p className="empty__body">{children}</p>}
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}

/** Shows an ApiError: what happened, plus the request id for support. */
export function ErrorNotice({ error, onRetry, title }) {
  if (!error) return null;
  return (
    <div className="notice notice--error" role="alert">
      <Icon name="alert" size={18} />
      <div className="notice__body">
        <p className="notice__title">{title ?? error.message}</p>
        {title && <p>{error.message}</p>}
        {error.requestId && <p className="notice__meta">Reference {error.requestId.slice(0, 8)}</p>}
      </div>
      {onRetry && (
        <button className="notice__action" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Notice({ tone = 'info', children, action }) {
  return (
    <div className={`notice notice--${tone}`}>
      <div className="notice__body">{children}</div>
      {action && <div className="notice__action-slot">{action}</div>}
    </div>
  );
}
