import { STATUS_LABEL } from '../lib/slots.js';

export function StatusBadge({ status }) {
  return <span className={`badge badge--${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}
