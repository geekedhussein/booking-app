import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { resourcesApi } from '../../lib/endpoints.js';
import { toMinutes } from '../../lib/datetime.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { Button } from '../../components/Button.jsx';
import { TextField } from '../../components/Field.jsx';
import { Icon } from '../../components/Icon.jsx';
import { ErrorNotice, Notice, PageLoader } from '../../components/Feedback.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

const EMPTY = {
  name: '',
  capacity: 1,
  minDurationMinutes: 0,
  maxDurationMinutes: '',
  leadTimeMinutes: 0,
  bufferMinutes: 0,
};

// Monday-first display; values match the backend (0 = Sunday).
const DAYS = [
  { dow: 1, label: 'Monday' },
  { dow: 2, label: 'Tuesday' },
  { dow: 3, label: 'Wednesday' },
  { dow: 4, label: 'Thursday' },
  { dow: 5, label: 'Friday' },
  { dow: 6, label: 'Saturday' },
  { dow: 0, label: 'Sunday' },
];

function toForm(r) {
  return {
    name: r.name,
    capacity: r.capacity,
    minDurationMinutes: r.minDurationMinutes ?? 0,
    maxDurationMinutes: r.maxDurationMinutes ?? '',
    leadTimeMinutes: r.leadTimeMinutes ?? 0,
    bufferMinutes: r.bufferMinutes ?? 0,
  };
}

function toPayload(form, { isNew }) {
  const n = (v) => Number(v);
  const body = {
    name: form.name.trim(),
    capacity: n(form.capacity),
    minDurationMinutes: n(form.minDurationMinutes),
    leadTimeMinutes: n(form.leadTimeMinutes),
    bufferMinutes: n(form.bufferMinutes),
  };
  if (form.maxDurationMinutes !== '') body.maxDurationMinutes = n(form.maxDurationMinutes);
  else if (!isNew) body.maxDurationMinutes = null; // clear an existing limit
  return body;
}

function DetailsForm({ resource, onSaved }) {
  const isNew = !resource;
  const [form, setForm] = useState(resource ? toForm(resource) : EMPTY);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  useEffect(() => {
    if (resource) setForm(toForm(resource));
  }, [resource]);

  const save = useMutation({
    mutationFn: () =>
      isNew
        ? resourcesApi.create(toPayload(form, { isNew }))
        : resourcesApi.update(resource.id, toPayload(form, { isNew })),
    onSuccess: ({ data }) => onSaved(data, isNew),
  });

  const fe = save.error?.fieldErrors ?? {};
  const formError = save.error && !Object.keys(fe).length ? save.error : null;

  return (
    <form
      className="editor-form"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      noValidate
    >
      <ErrorNotice error={formError} />
      <TextField label="Name" value={form.name} onChange={set('name')} error={fe.name} required maxLength={200} />
      <TextField
        label="Bookings at the same time"
        type="number"
        min={1}
        max={10000}
        hint="1 for one-to-one appointments or a private room; more for a class or shared space."
        value={form.capacity}
        onChange={set('capacity')}
        error={fe.capacity}
      />
      <div className="form-grid">
        <TextField
          label="Shortest booking (minutes)"
          type="number"
          min={0}
          max={1440}
          value={form.minDurationMinutes}
          onChange={set('minDurationMinutes')}
          error={fe.minDurationMinutes}
        />
        <TextField
          label="Longest booking (minutes)"
          type="number"
          min={1}
          max={1440}
          placeholder="No limit"
          value={form.maxDurationMinutes}
          onChange={set('maxDurationMinutes')}
          error={fe.maxDurationMinutes}
        />
        <TextField
          label="Book at least this far ahead (minutes)"
          type="number"
          min={0}
          value={form.leadTimeMinutes}
          onChange={set('leadTimeMinutes')}
          error={fe.leadTimeMinutes}
        />
        <TextField
          label="Turnover between bookings (minutes)"
          type="number"
          min={0}
          max={1440}
          hint="Time kept free after each booking for cleaning or changeover."
          value={form.bufferMinutes}
          onChange={set('bufferMinutes')}
          error={fe.bufferMinutes}
        />
      </div>
      <div>
        <Button variant="primary" type="submit" loading={save.isPending}>
          {isNew ? 'Add calendar' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}

function HoursEditor({ resourceId }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['availability', String(resourceId)],
    queryFn: () => resourcesApi.availability(resourceId).then((r) => r.data),
  });
  const [days, setDays] = useState(null);

  useEffect(() => {
    if (!query.data) return;
    const grouped = Object.fromEntries(DAYS.map((d) => [d.dow, []]));
    for (const w of query.data) {
      grouped[w.dayOfWeek].push({ opensAt: w.opensAt.slice(0, 5), closesAt: w.closesAt.slice(0, 5) });
    }
    setDays(grouped);
  }, [query.data]);

  const save = useMutation({
    mutationFn: () =>
      resourcesApi.setAvailability(
        resourceId,
        DAYS.flatMap((d) => days[d.dow].map((w) => ({ dayOfWeek: d.dow, ...w }))),
      ),
    onSuccess: () => {
      toast.success('Opening hours saved');
      queryClient.invalidateQueries({ queryKey: ['availability', String(resourceId)] });
      queryClient.invalidateQueries({ queryKey: ['schedule', String(resourceId)] });
    },
  });

  if (query.isLoading || !days) return <PageLoader />;

  const update = (dow, fn) => setDays((cur) => ({ ...cur, [dow]: fn(cur[dow]) }));
  const total = DAYS.reduce((n, d) => n + days[d.dow].length, 0);

  const problems = DAYS.flatMap((d) => {
    const ws = [...days[d.dow]].sort((a, b) => a.opensAt.localeCompare(b.opensAt));
    const errs = [];
    ws.forEach((w, i) => {
      if (!w.opensAt || !w.closesAt || w.opensAt >= w.closesAt) errs.push(`${d.label}: closing time must be after opening time.`);
      if (i > 0 && toMinutes(w.opensAt) < toMinutes(ws[i - 1].closesAt)) errs.push(`${d.label}: two time ranges overlap.`);
    });
    return errs;
  });

  return (
    <div className="hours">
      {total === 0 && (
        <Notice tone="info">No opening hours set, so this calendar can be booked at any time of day.</Notice>
      )}
      <ErrorNotice error={save.error} />

      <ul className="hours__days">
        {DAYS.map((d) => (
          <li key={d.dow} className="hours__day">
            <span className="hours__label">{d.label}</span>
            <div className="hours__windows">
              {days[d.dow].length === 0 && <span className="muted">Closed</span>}
              {days[d.dow].map((w, i) => (
                <div key={i} className="hours__window">
                  <input
                    type="time"
                    className="input input--time"
                    value={w.opensAt}
                    aria-label={`${d.label} opens`}
                    onChange={(e) => update(d.dow, (ws) => ws.map((x, j) => (j === i ? { ...x, opensAt: e.target.value } : x)))}
                  />
                  <span aria-hidden="true">to</span>
                  <input
                    type="time"
                    className="input input--time"
                    value={w.closesAt}
                    aria-label={`${d.label} closes`}
                    onChange={(e) => update(d.dow, (ws) => ws.map((x, j) => (j === i ? { ...x, closesAt: e.target.value } : x)))}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${d.label} ${w.opensAt} to ${w.closesAt}`}
                    onClick={() => update(d.dow, (ws) => ws.filter((_, j) => j !== i))}
                  >
                    <Icon name="x" size={18} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="link-btn"
              onClick={() =>
                update(d.dow, (ws) => {
                  const last = ws[ws.length - 1];
                  return [...ws, last ? { opensAt: last.closesAt, closesAt: '22:00' } : { opensAt: '09:00', closesAt: '17:00' }];
                })
              }
            >
              <Icon name="plus" size={16} /> Add hours
            </button>
          </li>
        ))}
      </ul>

      {problems.length > 0 && (
        <div className="notice notice--error" role="alert">
          <div className="notice__body">
            {[...new Set(problems)].map((p) => <p key={p}>{p}</p>)}
          </div>
        </div>
      )}

      <div className="row-actions">
        <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={problems.length > 0}>
          Save opening hours
        </Button>
        <Button
          variant="ghost"
          onClick={() => setDays((cur) => ({ ...cur, 2: [...cur[1]], 3: [...cur[1]], 4: [...cur[1]], 5: [...cur[1]] }))}
        >
          Copy Monday to weekdays
        </Button>
      </div>
    </div>
  );
}

export function ResourceEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['resource', id],
    queryFn: () => resourcesApi.get(id).then((r) => r.data),
    enabled: !isNew,
  });
  useDocumentTitle(isNew ? 'Add calendar' : query.data?.name);
  const { user, isProvider } = useAuth();

  function onSaved(resource, created) {
    queryClient.invalidateQueries({ queryKey: ['resources'] });
    queryClient.invalidateQueries({ queryKey: ['provider'] });
    queryClient.invalidateQueries({ queryKey: ['providers'] });
    queryClient.setQueryData(['resource', String(resource.id)], resource);
    if (created) {
      toast.success(`${resource.name} added. Now set its opening hours.`);
      navigate(`/manage/resources/${resource.id}`, { replace: true });
    } else {
      toast.success('Changes saved');
    }
  }

  if (!isNew && query.isLoading) return <PageLoader />;
  if (!isNew && query.error) {
    return (
      <div className="page">
        <ErrorNotice error={query.error} onRetry={query.refetch} />
      </div>
    );
  }

  // Providers can only change their own calendars (the API enforces this too).
  const notMine = !isNew && isProvider && query.data.providerSlug !== user.provider?.slug;

  return (
    <div className="page page--narrow">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/manage">Calendars</Link>
        <Icon name="chevronRight" size={14} />
        <span aria-current="page">{isNew ? 'Add calendar' : query.data.name}</span>
      </nav>
      <header className="page__header">
        <h1 className="page__title">{isNew ? 'Add a calendar' : query.data.name}</h1>
        {!isNew && (
          <Button size="sm" variant="ghost" to={`/resources/${id}`}>
            View booking page
          </Button>
        )}
      </header>

      {notMine && (
        <Notice tone="info">This calendar belongs to {query.data.providerName ?? 'someone else'}, so you can't change it.</Notice>
      )}

      <section className="settings-section">
        <div className="settings-section__intro">
          <h2 className="settings-section__title">Details and rules</h2>
          <p className="muted">These rules apply to every new booking and every reschedule.</p>
        </div>
        <div className="settings-section__body">
          <DetailsForm resource={isNew ? null : query.data} onSaved={onSaved} />
        </div>
      </section>

      {!isNew && (
        <section className="settings-section">
          <div className="settings-section__intro">
            <h2 className="settings-section__title">Opening hours</h2>
            <p className="muted">Add more than one range in a day for split hours, like a lunch break.</p>
          </div>
          <div className="settings-section__body">
            <HoursEditor resourceId={id} />
          </div>
        </section>
      )}
    </div>
  );
}
