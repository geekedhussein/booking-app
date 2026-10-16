import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { providerPath } from '../lib/providers.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { resourcesApi, bookingsApi } from '../lib/endpoints.js';
import { newIdempotencyKey } from '../lib/api.js';
import { defaultDuration } from '../lib/slots.js';
import { describeCapacity, describeRules } from '../lib/rules.js';
import {
  formatDuration,
  formatLongDate,
  formatRange,
  fromMinutes,
  joinLocal,
  splitLocal,
  todayISO,
} from '../lib/datetime.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useBookingSocket } from '../hooks/useBookingSocket.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { SlotPicker } from '../components/SlotPicker.jsx';
import { Button } from '../components/Button.jsx';
import { Icon } from '../components/Icon.jsx';
import { EmptyState, ErrorNotice, PageLoader } from '../components/Feedback.jsx';
import { useToast } from '../components/Toast.jsx';

/**
 * Booking for one calendar. Used as its own page (/resources/:id) and
 * `embedded` on a provider's page when they have a single calendar.
 */
export function ResourceDetailPage({ resourceId, embedded = false }) {
  const params = useParams();
  const id = resourceId ?? params.id;
  const { user } = useAuth();
  const location = useLocation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const resourceQuery = useQuery({
    queryKey: ['resource', id],
    queryFn: () => resourcesApi.get(id).then((r) => r.data),
  });
  const resource = resourceQuery.data;
  useDocumentTitle(embedded ? undefined : resource?.name);

  const [date, setDate] = useState(todayISO());
  const [duration, setDuration] = useState(null);
  const [selection, setSelection] = useState(null);
  const [confirmed, setConfirmed] = useState(null);

  // One idempotency key per booking ATTEMPT (backend V2.2). It survives retries
  // of the same selection — so a retry after a lost response returns the
  // original booking instead of creating a second — and resets when the
  // selection changes or the attempt reaches a final answer.
  const attemptKey = useRef(null);

  useEffect(() => {
    if (resource && duration == null) setDuration(defaultDuration(resource));
  }, [resource, duration]);

  const select = useCallback((slot) => {
    attemptKey.current = null;
    setConfirmed(null);
    setSelection(slot ? { start: slot.start, end: slot.end } : null);
  }, []);

  const changeDate = (d) => {
    setDate(d);
    select(null);
  };
  const changeDuration = (d) => {
    setDuration(d);
    select(null);
  };

  const onSelectionLost = useCallback(() => {
    select(null);
    toast.info('Someone just booked the time you picked. Choose another.');
  }, [select, toast]);

  const { connected } = useBookingSocket(id, { enabled: Boolean(user) });

  const book = useMutation({
    mutationFn: () => {
      if (!attemptKey.current) attemptKey.current = newIdempotencyKey();
      return bookingsApi.create(
        {
          resourceId: id,
          startsAt: joinLocal(date, selection.start),
          endsAt: joinLocal(date, selection.end),
        },
        attemptKey.current,
      );
    },
    onSuccess: ({ data }) => {
      attemptKey.current = null;
      setConfirmed(data);
      setSelection(null);
      toast.success(`Booked ${resource.name}, ${formatLongDate(date)} at ${fromMinutes(selection.start)}`);
      queryClient.invalidateQueries({ queryKey: ['schedule', id] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
    onError: (err) => {
      // A final answer from the server ends this attempt; a network failure
      // keeps the key so retrying is safe.
      if (err.status) attemptKey.current = null;
      if (err.status === 409) {
        setSelection(null);
        queryClient.invalidateQueries({ queryKey: ['schedule', id] });
      }
    },
  });

  const summary = useMemo(() => {
    if (!selection) return null;
    return {
      date: formatLongDate(date),
      time: `${fromMinutes(selection.start)}–${fromMinutes(selection.end)}`,
      duration: formatDuration(selection.end - selection.start),
    };
  }, [selection, date]);

  const Wrap = embedded ? 'div' : PageWrap;
  if (resourceQuery.isLoading) return <PageLoader />;
  if (resourceQuery.error) {
    return (
      <Wrap>
        {resourceQuery.error.status === 404 ? (
          <EmptyState title="This calendar doesn't exist" action={<Button to="/">Find a provider</Button>}>
            It may have been removed.
          </EmptyState>
        ) : (
          <ErrorNotice error={resourceQuery.error} onRetry={resourceQuery.refetch} />
        )}
      </Wrap>
    );
  }
  const backTo = resource.providerSlug ? providerPath(resource.providerSlug) : '/';
  if (!resource.isActive) {
    return (
      <Wrap>
        <EmptyState
          title={`${resource.name} isn't taking bookings`}
          action={<Button to={backTo}>{resource.providerName ? `See ${resource.providerName}` : 'Find a provider'}</Button>}
        >
          {resource.providerName ? `${resource.providerName} has paused this calendar.` : 'Bookings are paused for now.'}
        </EmptyState>
      </Wrap>
    );
  }

  const bookError = book.error;
  const conflict = bookError?.status === 409;

  return (
    <div className={embedded ? 'booking-embed' : 'page page--booking'}>
      {!embedded && (
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link to="/">Find</Link>
          <Icon name="chevronRight" size={14} />
          {resource.providerSlug && (
            <>
              <Link to={backTo}>{resource.providerName}</Link>
              <Icon name="chevronRight" size={14} />
            </>
          )}
          <span aria-current="page">{resource.name}</span>
        </nav>
      )}

      <div className="booking-layout">
        <div className="booking-layout__main">
          <header className="resource-head">
            {embedded ? (
              <h2 className="resource-head__name">{resource.name}</h2>
            ) : (
              <h1 className="page__title">{resource.name}</h1>
            )}
            <p className="resource-head__rules">{describeRules(resource)}</p>
            <p className="resource-head__cap">
              <Icon name="people" size={18} />
              {describeCapacity(resource.capacity)}
              {user && (
                <span className={`live${connected ? ' is-on' : ''}`} title={connected ? 'Updates appear as they happen' : 'Reconnecting'}>
                  <span className="live__dot" aria-hidden="true" />
                  {connected ? 'Live' : 'Offline'}
                </span>
              )}
            </p>
          </header>

          {duration != null && (
            <SlotPicker
              resource={resource}
              date={date}
              onDateChange={changeDate}
              duration={duration}
              onDurationChange={changeDuration}
              selection={selection}
              onSelect={select}
              onSelectionLost={onSelectionLost}
            />
          )}
        </div>

        <aside className={`summary${selection || confirmed ? ' has-content' : ''}`} aria-label="Your booking">
          {confirmed ? (
            <div className="summary__done">
              <p className="summary__kicker">
                <Icon name="check" size={18} /> Booked
              </p>
              <p className="summary__time">{formatRange(confirmed.startsAt, confirmed.endsAt)}</p>
              <p className="summary__date">{formatLongDate(splitLocal(confirmed.startsAt).date)}</p>
              <div className="summary__actions">
                <Button variant="primary" to="/bookings" block>
                  View my bookings
                </Button>
                <Button variant="ghost" onClick={() => setConfirmed(null)} block>
                  Book another time
                </Button>
              </div>
            </div>
          ) : summary ? (
            <>
              <h2 className="summary__heading">{resource.name}</h2>
              <p className="summary__time">{summary.time}</p>
              <p className="summary__date">
                {summary.date}, {summary.duration}
              </p>
              {bookError && (
                <ErrorNotice
                  error={bookError}
                  title={conflict ? 'That time was just taken' : undefined}
                />
              )}
              {user ? (
                <Button variant="primary" onClick={() => book.mutate()} loading={book.isPending} block>
                  {bookError && !bookError.status ? 'Try booking again' : `Book ${summary.time}`}
                </Button>
              ) : (
                <Button variant="primary" to="/login" state={{ from: location }} block>
                  Sign in to book
                </Button>
              )}
            </>
          ) : (
            <p className="summary__placeholder">
              {conflict ? 'That time was just taken. Pick another.' : 'Pick a time to see your booking here.'}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

const PageWrap = ({ children }) => <div className="page">{children}</div>;
