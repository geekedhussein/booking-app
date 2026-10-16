import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { providerPath } from '../lib/providers.js';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bookingsApi, resourcesApi } from '../lib/endpoints.js';
import { formatDuration, formatRange, formatRelativeDay, nowLocal, splitLocal, todayISO } from '../lib/datetime.js';
import { isActive } from '../lib/slots.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { Button } from '../components/Button.jsx';
import { Icon } from '../components/Icon.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { EmptyState, ErrorNotice } from '../components/Feedback.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { RescheduleDialog } from '../components/RescheduleDialog.jsx';
import { BookingHistoryDialog } from '../components/BookingHistory.jsx';
import { useToast } from '../components/Toast.jsx';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'pending', label: 'Pending' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'no_show', label: 'No-show' },
];

export function MyBookingsPage() {
  useDocumentTitle('My bookings');
  const [status, setStatus] = useState('');
  const [rescheduling, setRescheduling] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [history, setHistory] = useState(null);
  const toast = useToast();
  const queryClient = useQueryClient();

  // Cursor pagination (backend V2.10): each page returns an opaque nextCursor we
  // hand back verbatim. useInfiniteQuery is a natural fit.
  const query = useInfiniteQuery({
    queryKey: ['bookings', 'mine', status],
    queryFn: ({ pageParam }) => bookingsApi.listMine({ cursor: pageParam, status: status || undefined }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.pagination.nextCursor ?? undefined,
  });

  const bookings = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);

  // The API returns newest-first (right for cursor history), but people read
  // upcoming bookings soonest-first. So: Upcoming ascending, Past descending.
  const sections = useMemo(() => {
    const today = todayISO();
    const byDate = new Map();
    for (const b of bookings) {
      const date = splitLocal(b.startsAt).date;
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(b);
    }
    for (const list of byDate.values()) list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const dates = [...byDate.keys()];
    const upcoming = dates.filter((d) => d >= today).sort();
    const past = dates.filter((d) => d < today).sort().reverse();
    return [
      { title: 'Upcoming', days: upcoming.map((d) => [d, byDate.get(d)]) },
      { title: 'Past', days: past.map((d) => [d, byDate.get(d)]) },
    ].filter((sec) => sec.days.length);
  }, [bookings]);

  const cancel = useMutation({
    mutationFn: (b) => bookingsApi.cancel(b.id),
    onSuccess: (_res, b) => {
      toast.success('Booking cancelled');
      setCancelling(null);
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['schedule', String(b.resourceId)] });
    },
    onError: (err) => toast.error(err.message),
  });

  // The reschedule picker needs the calendar's rules and hours.
  const reschedulingResource = useQuery({
    queryKey: ['resource', String(rescheduling?.resourceId)],
    queryFn: () => resourcesApi.get(rescheduling.resourceId).then((r) => r.data),
    enabled: Boolean(rescheduling),
  });

  const now = nowLocal();

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">My bookings</h1>
        <Button to="/" variant="primary" size="sm">
          <Icon name="plus" size={18} /> New booking
        </Button>
      </header>

      <div className="segmented" role="tablist" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={status === f.value}
            className={`segmented__item${status === f.value ? ' is-selected' : ''}`}
            onClick={() => setStatus(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <ErrorNotice error={query.error} onRetry={query.refetch} />

      {query.isLoading && (
        <ul className="ledger" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => <li key={i} className="ledger__row is-skeleton" />)}
        </ul>
      )}

      {query.data && bookings.length === 0 && (
        <EmptyState
          title={status ? `No ${FILTERS.find((f) => f.value === status).label.toLowerCase()} bookings` : 'No bookings yet'}
          action={<Button to="/" variant="primary">Find a provider</Button>}
        >
          {status ? 'Try another filter.' : 'Your reservations will show up here.'}
        </EmptyState>
      )}

      {sections.map((section) => (
        <section key={section.title} className="booking-section" aria-labelledby={`s-${section.title}`}>
          <h2 id={`s-${section.title}`} className="booking-section__title">
            {section.title}
          </h2>
      {section.days.map(([date, items]) => (
        <div key={date} className="day-group">
          <h3 className="day-group__title">{formatRelativeDay(date)}</h3>
          <ul className="ledger">
            {items.map((b) => {
              const upcoming = b.startsAt > now;
              const canChange = isActive(b.status) && upcoming;
              const mins = splitLocal(b.endsAt).minutes - splitLocal(b.startsAt).minutes;
              return (
                <li key={b.id} className={`ledger__row booking-row${upcoming ? '' : ' is-past'}`}>
                  <p className="booking-row__time">{formatRange(b.startsAt, b.endsAt)}</p>
                  <div className="booking-row__main">
                    <p className="booking-row__name">{b.resourceName ?? `Calendar ${b.resourceId}`}</p>
                    <p className="booking-row__meta">
                      {b.providerSlug && (
                        <>
                          <Link to={providerPath(b.providerSlug)}>{b.providerName}</Link> ·{' '}
                        </>
                      )}
                      {formatDuration(mins)}
                    </p>
                  </div>
                  <StatusBadge status={b.status} />
                  <div className="booking-row__actions">
                    {canChange && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setRescheduling(b)}>
                          Reschedule
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setCancelling(b)}>
                          Cancel
                        </Button>
                      </>
                    )}
                    <button className="icon-btn" onClick={() => setHistory(b)} aria-label="View history" title="View history">
                      <Icon name="history" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
        </section>
      ))}

      {query.hasNextPage && (
        <div className="load-more">
          <Button onClick={() => query.fetchNextPage()} loading={query.isFetchingNextPage}>
            Show older bookings
          </Button>
        </div>
      )}

      {rescheduling && (
        <RescheduleDialog
          booking={rescheduling}
          resource={reschedulingResource.data}
          onClose={() => setRescheduling(null)}
        />
      )}

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
            {cancelling.resourceName}
            {cancelling.providerName ? ` with ${cancelling.providerName}` : ''}, {formatRelativeDay(splitLocal(cancelling.startsAt).date)}{' '}
            at {formatRange(cancelling.startsAt, cancelling.endsAt)}. The time becomes available to others straight
            away.
          </p>
        )}
      </ConfirmDialog>

      <BookingHistoryDialog booking={history} onClose={() => setHistory(null)} />
    </div>
  );
}
