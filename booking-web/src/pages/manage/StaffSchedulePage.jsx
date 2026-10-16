import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { resourcesApi } from '../../lib/endpoints.js';
import { formatLongDate, nowMinutes, todayISO } from '../../lib/datetime.js';
import { useManagedCalendars } from '../../hooks/useManagedCalendars.js';
import { useBookingSocket } from '../../hooks/useBookingSocket.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { Button } from '../../components/Button.jsx';
import { SelectField } from '../../components/Field.jsx';
import { DateStrip, DayTrack } from '../../components/DayTrack.jsx';
import { EmptyState, ErrorNotice } from '../../components/Feedback.jsx';
import { ManagedBookingList } from '../../components/ManagedBookingList.jsx';

export function StaffSchedulePage() {
  useDocumentTitle('Schedule');
  const [params, setParams] = useSearchParams();

  const date = params.get('date') ?? todayISO();
  const resourceId = params.get('resource');

  // A provider sees their own calendars; staff see every one.
  const resources = useManagedCalendars();

  // Default to the first resource once the list arrives.
  useEffect(() => {
    if (!resourceId && resources.data?.length) {
      setParams((p) => {
        p.set('resource', String(resources.data[0].id));
        return p;
      }, { replace: true });
    }
  }, [resourceId, resources.data, setParams]);

  const setParam = (key, value) =>
    setParams((p) => {
      p.set(key, value);
      return p;
    });

  const schedule = useQuery({
    queryKey: ['schedule', resourceId, date],
    queryFn: () => resourcesApi.schedule(resourceId, date).then((r) => r.data),
    enabled: Boolean(resourceId),
  });
  const bookings = useQuery({
    queryKey: ['dayBookings', resourceId, date],
    queryFn: () => resourcesApi.dayBookings(resourceId, date).then((r) => r.data),
    enabled: Boolean(resourceId),
  });

  const { connected } = useBookingSocket(resourceId, { enabled: Boolean(resourceId) });

  const resource = resources.data?.find((r) => String(r.id) === resourceId);
  const list = bookings.data ?? [];
  const activeCount = list.filter((b) => b.status === 'pending' || b.status === 'confirmed').length;

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">Schedule</h1>
        <span className={`live${connected ? ' is-on' : ''}`}>
          <span className="live__dot" aria-hidden="true" />
          {connected ? 'Live' : 'Offline'}
        </span>
      </header>

      <ErrorNotice error={resources.error} onRetry={resources.refetch} />

      {resources.data?.length === 0 && (
        <EmptyState title="No calendars yet" action={<Button to="/manage/resources/new" variant="primary">Add a calendar</Button>}>
          Add something clients can book before its schedule can appear here.
        </EmptyState>
      )}

      {resources.data?.length > 0 && (
        <>
          <div className="schedule-controls">
            <SelectField
              label="Calendar"
              value={resourceId ?? ''}
              onChange={(e) => setParam('resource', e.target.value)}
            >
              {resources.data.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.isActive ? '' : ' (paused)'}
                </option>
              ))}
            </SelectField>
            <div className="field">
              <label className="field__label" htmlFor="schedule-date">Date</label>
              <input
                id="schedule-date"
                type="date"
                className="input"
                value={date}
                onChange={(e) => e.target.value && setParam('date', e.target.value)}
              />
            </div>
          </div>

          <DateStrip value={date < todayISO() ? todayISO() : date} onChange={(d) => setParam('date', d)} />

          <h2 className="schedule-heading">
            {formatLongDate(date)}
            {resource && (
              <span className="muted">
                {activeCount} {activeCount === 1 ? 'booking' : 'bookings'},{' '}
                {resource.capacity > 1 ? `up to ${resource.capacity} at a time` : 'one at a time'}
              </span>
            )}
          </h2>

          {schedule.data && (
            <DayTrack schedule={schedule.data} nowMinute={date === todayISO() ? nowMinutes() : null} />
          )}

          <ErrorNotice error={bookings.error} onRetry={bookings.refetch} />

          {bookings.data && list.length === 0 && (
            <EmptyState title="Nothing booked">No bookings for {resource?.name ?? 'this calendar'} on this day.</EmptyState>
          )}

          {list.length > 0 && <ManagedBookingList bookings={list} />}
        </>
      )}

    </div>
  );
}
