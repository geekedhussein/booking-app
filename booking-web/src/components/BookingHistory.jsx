import { useQuery } from '@tanstack/react-query';
import { bookingsApi } from '../lib/endpoints.js';
import { formatRange, formatStamp, formatDayMonth, splitLocal } from '../lib/datetime.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ErrorNotice, Spinner } from './Feedback.jsx';
import { Modal } from './Modal.jsx';

function describe(entry) {
  switch (entry.action) {
    case 'created':
      return 'Booked';
    case 'rescheduled': {
      const { from, to } = entry.details ?? {};
      if (!from || !to) return 'Moved';
      const sameDay = splitLocal(from.startsAt).date === splitLocal(to.startsAt).date;
      return sameDay
        ? `Moved from ${formatRange(from.startsAt, from.endsAt)} to ${formatRange(to.startsAt, to.endsAt)}`
        : `Moved to ${formatDayMonth(splitLocal(to.startsAt).date)}, ${formatRange(to.startsAt, to.endsAt)}`;
    }
    case 'cancelled':
      return 'Cancelled';
    case 'completed':
      return 'Marked as completed';
    case 'no_show':
      return 'Marked as no-show';
    case 'confirmed':
      return 'Confirmed';
    default:
      return entry.action;
  }
}

/** The append-only audit trail (backend V2.8) as a timeline. */
export function BookingHistoryDialog({ booking, onClose }) {
  const { user } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['audit', booking?.id],
    queryFn: () => bookingsApi.audit(booking.id).then((r) => r.data),
    enabled: Boolean(booking),
  });

  // Who did it, from the viewer's point of view: you, the client who booked,
  // the provider who runs the calendar, or (for staff-run calendars) staff.
  const who = (entry) => {
    if (entry.actorUserId == null) return 'automatically';
    if (String(entry.actorUserId) === String(user?.id)) return 'by you';
    if (String(entry.actorUserId) === String(booking?.userId)) return 'by the client';
    return booking?.providerName ? 'by the provider' : 'by staff';
  };

  return (
    <Modal open={Boolean(booking)} onClose={onClose} title="Booking history" size="sm">
      {isLoading && <Spinner />}
      <ErrorNotice error={error} onRetry={refetch} />
      {data && (
        <ol className="history">
          {data.map((entry) => (
            <li key={entry.id} className={`history__item history__item--${entry.action}`}>
              <p className="history__what">{describe(entry)}</p>
              <p className="history__meta">
                {formatStamp(entry.at)}, {who(entry)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
