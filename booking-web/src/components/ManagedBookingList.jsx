import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { bookingsApi } from '../lib/endpoints.js';
import { canTransition } from '../lib/slots.js';
import { formatRange, nowLocal } from '../lib/datetime.js';
import { Button } from './Button.jsx';
import { Icon } from './Icon.jsx';
import { StatusBadge } from './StatusBadge.jsx';
import { ConfirmDialog } from './Modal.jsx';
import { BookingHistoryDialog } from './BookingHistory.jsx';
import { useToast } from './Toast.jsx';

// Ids are 24-character MongoDB ObjectIds; the last six are a readable reference
// that's unique enough to tell a client "your booking 3F9A2C".
const bookingRef = (id) => String(id).slice(-6).toUpperCase();

const ACTIONS = [
  { to: 'confirmed', label: 'Confirm', done: 'Booking confirmed', call: bookingsApi.confirm },
  { to: 'completed', label: 'Mark completed', done: 'Marked as completed', call: bookingsApi.complete },
  { to: 'no_show', label: 'Mark no-show', done: 'Marked as no-show', call: bookingsApi.noShow },
];

/**
 * Bookings as seen by whoever runs the calendar (a provider or staff): who
 * booked, when, the status, and the actions that status allows. Shared by the
 * provider dashboard and the day schedule so both behave identically.
 *
 * showCalendar: name the calendar on each row (when several are listed).
 */
// Completed and no-show describe something that has happened, so they're only
// offered once the booking has started. (Confirm and Cancel work any time.)
const AFTER_START = new Set(['completed', 'no_show']);

export function ManagedBookingList({ bookings, showCalendar = false }) {
  const now = nowLocal();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState(null);
  const [history, setHistory] = useState(null);

  const refresh = (b) => {
    queryClient.invalidateQueries({ queryKey: ['dayBookings', String(b.resourceId)] });
    queryClient.invalidateQueries({ queryKey: ['schedule', String(b.resourceId)] });
    queryClient.invalidateQueries({ queryKey: ['providerBookings'] });
    queryClient.invalidateQueries({ queryKey: ['bookings'] });
  };

  const transition = useMutation({
    mutationFn: ({ booking, action }) => action.call(booking.id),
    onSuccess: (_r, { booking, action }) => {
      toast.success(action.done);
      refresh(booking);
    },
    onError: (err) => toast.error(err.message),
  });

  const cancel = useMutation({
    mutationFn: (b) => bookingsApi.cancel(b.id),
    onSuccess: (_r, b) => {
      toast.success('Booking cancelled');
      setCancelling(null);
      refresh(b);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <>
      <ul className="ledger">
        {bookings.map((b) => (
          <li key={b.id} className={`ledger__row booking-row${b.status === 'cancelled' ? ' is-past' : ''}`}>
            <p className="booking-row__time">{formatRange(b.startsAt, b.endsAt)}</p>
            <div className="booking-row__main">
              <p className="booking-row__name">{b.userEmail}</p>
              <p className="booking-row__meta">
                {showCalendar && b.resourceName ? `${b.resourceName} · ` : ''}Ref {bookingRef(b.id)}
              </p>
            </div>
            <StatusBadge status={b.status} />
            <div className="booking-row__actions">
              {ACTIONS.filter(
                (a) => canTransition(b.status, a.to) && (!AFTER_START.has(a.to) || b.startsAt <= now),
              ).map((a) => (
                <Button
                  key={a.to}
                  size="sm"
                  variant={a.to === 'confirmed' || a.to === 'completed' ? 'secondary' : 'ghost'}
                  loading={
                    transition.isPending &&
                    transition.variables?.booking.id === b.id &&
                    transition.variables?.action.to === a.to
                  }
                  onClick={() => transition.mutate({ booking: b, action: a })}
                >
                  {a.label}
                </Button>
              ))}
              {canTransition(b.status, 'cancelled') && (
                <Button size="sm" variant="ghost" onClick={() => setCancelling(b)}>
                  Cancel
                </Button>
              )}
              <button className="icon-btn" onClick={() => setHistory(b)} aria-label="View history" title="View history">
                <Icon name="history" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        onConfirm={() => cancel.mutate(cancelling)}
        loading={cancel.isPending}
        title="Cancel this booking?"
        confirmLabel="Cancel booking"
        cancelLabel="Keep booking"
      >
        {cancelling && (
          <p>
            {cancelling.userEmail}, {formatRange(cancelling.startsAt, cancelling.endsAt)}. They'll see it as
            cancelled and the time opens up for others.
          </p>
        )}
      </ConfirmDialog>

      <BookingHistoryDialog booking={history} onClose={() => setHistory(null)} />
    </>
  );
}
