import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { providersApi } from '../../lib/endpoints.js';
import { addDays, formatRelativeDay, splitLocal, todayISO } from '../../lib/datetime.js';
import { isActive } from '../../lib/slots.js';
import { providerPath, providerUrl } from '../../lib/providers.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useBookingSocket } from '../../hooks/useBookingSocket.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { Button } from '../../components/Button.jsx';
import { TextField } from '../../components/Field.jsx';
import { Icon } from '../../components/Icon.jsx';
import { EmptyState, ErrorNotice } from '../../components/Feedback.jsx';
import { Modal } from '../../components/Modal.jsx';
import { ManagedBookingList } from '../../components/ManagedBookingList.jsx';
import { useToast } from '../../components/Toast.jsx';
import { SlugField } from '../AuthPages.jsx';
import { Monogram } from '../ResourcesPage.jsx';

const RANGES = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past 30 days' },
];

/** One live subscription per calendar; reports whether it's connected. */
function CalendarSocket({ id, onStatus }) {
  const { connected } = useBookingSocket(id);
  useEffect(() => onStatus(id, connected), [id, connected, onStatus]);
  return null;
}

/**
 * The provider's admin page: their link to share, and every booking clients
 * have made on their calendars, grouped by day, with the actions to run them.
 */
export function DashboardPage() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  useDocumentTitle('Dashboard');
  const [range, setRange] = useState('upcoming');
  const [editing, setEditing] = useState(false);
  const [sockets, setSockets] = useState({});

  const today = todayISO();
  const span = range === 'upcoming' ? { from: today, to: addDays(today, 30) } : { from: addDays(today, -30), to: addDays(today, -1) };

  const mine = useQuery({ queryKey: ['resources', 'managed', user.id], queryFn: () => providersApi.mine().then((r) => r.data.calendars) });
  const bookings = useQuery({
    queryKey: ['providerBookings', range, span.from],
    queryFn: () => providersApi.bookings(span).then((r) => r.data),
    refetchInterval: 60_000, // a safety net; live events refresh it sooner
  });

  const onStatus = useCallback((id, connected) => setSockets((s) => (s[id] === connected ? s : { ...s, [id]: connected })), []);
  const calendars = mine.data ?? [];
  const live = calendars.length > 0 && calendars.every((c) => sockets[c.id]);

  const list = useMemo(() => {
    const rows = bookings.data ?? [];
    // Past bookings read newest first; upcoming soonest first.
    return range === 'past' ? [...rows].reverse() : rows;
  }, [bookings.data, range]);

  const days = useMemo(() => {
    const byDate = new Map();
    for (const b of list) {
      const d = splitLocal(b.startsAt).date;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(b);
    }
    if (range === 'past') for (const items of byDate.values()) items.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return [...byDate.entries()];
  }, [list, range]);

  const upcomingActive = range === 'upcoming' ? list.filter((b) => isActive(b.status)) : [];
  const todayCount = upcomingActive.filter((b) => splitLocal(b.startsAt).date === today).length;
  const provider = user.provider;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(providerUrl(provider.slug));
      toast.success('Link copied');
    } catch {
      toast.info(providerUrl(provider.slug));
    }
  }

  return (
    <div className="page">
      {calendars.map((c) => (
        <CalendarSocket key={c.id} id={c.id} onStatus={onStatus} />
      ))}

      <header className="provider-head provider-head--dashboard">
        <Monogram name={provider.displayName} size="lg" />
        <div className="provider-head__text">
          <h1 className="page__title">{provider.displayName}</h1>
          {provider.headline && <p className="provider-head__headline">{provider.headline}</p>}
        </div>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          <Icon name="edit" size={16} /> Edit page
        </Button>
      </header>

      <section className="share" aria-label="Your page">
        <div className="share__text">
          <p className="share__label">Your booking page</p>
          <a className="share__url" href={providerPath(provider.slug)}>
            {providerUrl(provider.slug).replace(/^https?:\/\//, '')}
          </a>
        </div>
        <div className="share__actions">
          <Button size="sm" onClick={copyLink}>
            <Icon name="copy" size={16} /> Copy link
          </Button>
          <Button size="sm" variant="ghost" to={providerPath(provider.slug)}>
            <Icon name="external" size={16} /> View
          </Button>
        </div>
      </section>

      {mine.data && calendars.length === 0 && (
        <EmptyState
          title="Add your first calendar"
          action={<Button to="/manage/resources/new" variant="primary">Add a calendar</Button>}
        >
          A calendar is what clients book: you, a room, a court. Set its hours and rules, and your page starts taking
          bookings.
        </EmptyState>
      )}

      {calendars.length > 0 && (
        <>
          <div className="dashboard-bar">
            <div className="segmented" role="tablist" aria-label="Which bookings">
              {RANGES.map((r) => (
                <button
                  key={r.value}
                  role="tab"
                  aria-selected={range === r.value}
                  className={`segmented__item${range === r.value ? ' is-selected' : ''}`}
                  onClick={() => setRange(r.value)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <span className={`live${live ? ' is-on' : ''}`} title={live ? 'New bookings appear as they happen' : 'Reconnecting'}>
              <span className="live__dot" aria-hidden="true" />
              {live ? 'Live' : 'Offline'}
            </span>
          </div>

          {range === 'upcoming' && bookings.data && (
            <p className="dashboard-summary">
              <strong className="time">{todayCount}</strong> today ·{' '}
              <strong className="time">{upcomingActive.length}</strong> in the next 30 days
            </p>
          )}

          <ErrorNotice error={bookings.error} onRetry={bookings.refetch} />

          {bookings.isLoading && (
            <ul className="ledger" aria-hidden="true">
              {[0, 1, 2].map((i) => <li key={i} className="ledger__row is-skeleton" />)}
            </ul>
          )}

          {bookings.data && list.length === 0 && (
            <EmptyState
              title={range === 'upcoming' ? 'No bookings yet' : 'Nothing in the past 30 days'}
              action={range === 'upcoming' ? <Button onClick={copyLink}>Copy your link</Button> : undefined}
            >
              {range === 'upcoming' ? 'Share your page so clients can book you.' : 'Bookings you ran will be listed here.'}
            </EmptyState>
          )}

          {days.map(([date, items]) => (
            <div key={date} className="day-group">
              <h2 className="day-group__title">{formatRelativeDay(date)}</h2>
              <ManagedBookingList bookings={items} showCalendar={calendars.length > 1} />
            </div>
          ))}
        </>
      )}

      {editing && (
        <EditPageDialog
          provider={provider}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            await refreshUser();
            setEditing(false);
            toast.success('Page updated');
          }}
        />
      )}
    </div>
  );
}

function EditPageDialog({ provider, onClose, onSaved }) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(provider.displayName);
  const [headline, setHeadline] = useState(provider.headline ?? '');
  const [slug, setSlug] = useState(provider.slug);

  const save = useMutation({
    mutationFn: () => providersApi.updateMine({ displayName, headline, slug }),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['provider'] });
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      await onSaved();
    },
  });
  const fe = save.error?.fieldErrors ?? {};
  const formError = save.error && !Object.keys(fe).length ? save.error : null;

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit your page"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <ErrorNotice error={formError} />
        <TextField label="Name clients will see" value={displayName} onChange={(e) => setDisplayName(e.target.value)} error={fe.displayName} maxLength={80} />
        <TextField label="What you offer" value={headline} onChange={(e) => setHeadline(e.target.value)} error={fe.headline} maxLength={160} />
        <SlugField
          value={slug}
          onChange={setSlug}
          error={fe.slug}
          hint={slug !== provider.slug ? 'Links you have already shared will stop working.' : 'Letters, numbers and hyphens.'}
        />
      </form>
    </Modal>
  );
}
