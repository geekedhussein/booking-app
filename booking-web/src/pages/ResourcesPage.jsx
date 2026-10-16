import { useDeferredValue, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { providersApi, resourcesApi } from '../lib/endpoints.js';
import { describeCapacity, describeRules } from '../lib/rules.js';
import { buildSlots, defaultDuration } from '../lib/slots.js';
import { fromMinutes, nowMinutes, todayISO } from '../lib/datetime.js';
import { providerPath } from '../lib/providers.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { MiniTrack } from '../components/DayTrack.jsx';
import { Icon } from '../components/Icon.jsx';
import { EmptyState, ErrorNotice } from '../components/Feedback.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

/** Today's availability for one calendar: the mini track and a one-line summary. */
function TodayAtAGlance({ resource }) {
  const today = todayISO();
  // Same query key as the booking page, so opening a calendar reuses this data.
  const { data: schedule, isLoading } = useQuery({
    queryKey: ['schedule', String(resource.id), today],
    queryFn: () => resourcesApi.schedule(resource.id, today).then((r) => r.data),
    staleTime: 30_000,
  });

  const summary = useMemo(() => {
    if (!schedule) return null;
    if (schedule.hasWindows && schedule.windows.length === 0) return { text: 'Closed today', tone: 'muted' };
    const next = buildSlots({
      schedule,
      date: today,
      duration: defaultDuration(resource),
      leadTime: resource.leadTimeMinutes,
    }).find((s) => s.status === 'open');
    return next
      ? { text: `Next free at ${fromMinutes(next.start)}`, tone: 'open' }
      : { text: 'Booked up today', tone: 'muted' };
  }, [schedule, resource, today]);

  return (
    <div className="glance">
      <p className={`glance__next${summary ? ` is-${summary.tone}` : ''}`}>
        {isLoading ? 'Checking today…' : summary?.text}
      </p>
      {schedule ? <MiniTrack schedule={schedule} nowMinute={nowMinutes()} /> : <div className="mini-track is-loading" />}
    </div>
  );
}

/** A provider's calendars as rows, each with today's availability. */
export function CalendarList({ calendars }) {
  return (
    <ul className="ledger">
      {calendars.map((r) => (
        <li key={r.id}>
          <Link to={`/resources/${r.id}`} className="ledger__row resource-row">
            <div className="resource-row__main">
              <h2 className="resource-row__name">{r.name}</h2>
              <p className="resource-row__rules">{describeRules(r)}</p>
              <p className="resource-row__cap">
                <Icon name="people" size={16} />
                {describeCapacity(r.capacity)}
              </p>
            </div>
            <TodayAtAGlance resource={r} />
            <Icon name="chevronRight" size={20} className="resource-row__chev" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Initials in a circle: a calm stand-in for a logo. */
export function Monogram({ name, size = 'md' }) {
  const initials = (name ?? '?')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  return (
    <span className={`monogram monogram--${size}`} aria-hidden="true">
      {initials || '?'}
    </span>
  );
}

/** Home: the directory of providers, searchable by name or what they offer. */
export function DirectoryPage() {
  useDocumentTitle('Find a provider');
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  // Search as you type, without a request per keystroke blocking the input.
  const q = useDeferredValue(search.trim());
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['providers', q],
    queryFn: () => providersApi.directory({ q }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Who would you like to book?</h1>
          <p className="page__lede">Choose a provider to see their calendars and free times.</p>
        </div>
        <label className="search">
          <Icon name="search" size={18} />
          <span className="visually-hidden">Search providers</span>
          <input
            type="search"
            placeholder="Search by name or service"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </header>

      <ErrorNotice error={error} onRetry={refetch} />

      {isLoading && (
        <ul className="ledger" aria-hidden="true">
          {[0, 1, 2].map((i) => <li key={i} className="ledger__row is-skeleton" />)}
        </ul>
      )}

      {data && data.length === 0 && (
        <EmptyState title={q ? `Nothing matches “${q}”` : 'No providers yet'}>
          {q ? 'Try a shorter search, or another word for the service.' : 'Providers appear here once they add a calendar.'}
        </EmptyState>
      )}

      {data?.length > 0 && (
        <ul className={`ledger${isFetching ? ' is-refreshing' : ''}`}>
          {data.map((p) => (
            <li key={p.id}>
              <Link to={providerPath(p.slug)} className="ledger__row provider-row">
                <Monogram name={p.displayName} />
                <div className="provider-row__main">
                  <h2 className="provider-row__name">{p.displayName}</h2>
                  {p.headline && <p className="provider-row__headline">{p.headline}</p>}
                </div>
                <p className="provider-row__count">
                  {p.calendarCount} {p.calendarCount === 1 ? 'calendar' : 'calendars'}
                </p>
                <Icon name="chevronRight" size={20} className="resource-row__chev" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!user && (
        <p className="directory__cta">
          Offer your services? <Link to="/register?as=provider">Create a provider page</Link>
        </p>
      )}
    </div>
  );
}
