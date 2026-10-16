import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { providerPath } from '../lib/providers.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext.jsx';
import { authApi, webhooksApi } from '../lib/endpoints.js';
import { formatLongDate, formatStamp, splitLocal } from '../lib/datetime.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { Button } from '../components/Button.jsx';
import { TextField } from '../components/Field.jsx';
import { Icon } from '../components/Icon.jsx';
import { ErrorNotice, Notice } from '../components/Feedback.jsx';
import { ConfirmDialog, Modal } from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';

const ROLE_LABEL = { customer: 'Client', provider: 'Service provider', staff: 'Staff', admin: 'Admin' };
const EVENTS = [
  { value: 'booking.created', label: 'Booking made' },
  { value: 'booking.rescheduled', label: 'Booking moved' },
  { value: 'booking.cancelled', label: 'Booking cancelled' },
  { value: 'booking.reminder', label: 'Reminder sent' },
];

function Section({ title, description, children }) {
  return (
    <section className="settings-section">
      <div className="settings-section__intro">
        <h2 className="settings-section__title">{title}</h2>
        {description && <p className="muted">{description}</p>}
      </div>
      <div className="settings-section__body">{children}</div>
    </section>
  );
}

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard blocked — the value is still selectable */
        }
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

function Webhooks() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState(['booking.created', 'booking.cancelled']);
  const [secret, setSecret] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [viewing, setViewing] = useState(null);

  const list = useQuery({ queryKey: ['webhooks'], queryFn: () => webhooksApi.list().then((r) => r.data) });
  const deliveries = useQuery({
    queryKey: ['deliveries', viewing?.id],
    queryFn: () => webhooksApi.deliveries(viewing.id).then((r) => r.data),
    enabled: Boolean(viewing),
  });

  const create = useMutation({
    mutationFn: () => webhooksApi.create({ url, eventTypes: events }),
    onSuccess: ({ data }) => {
      setSecret(data.secret); // shown once — the API never returns it again
      setUrl('');
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id) => webhooksApi.remove(id),
    onSuccess: () => {
      toast.success('Webhook removed');
      setRemoving(null);
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const toggle = (value) =>
    setEvents((cur) => (cur.includes(value) ? cur.filter((e) => e !== value) : [...cur, value]));

  return (
    <>
      {secret && (
        <Notice tone="success" action={<CopyButton value={secret} />}>
          <p>
            <strong>Save this signing secret now.</strong> You won't see it again. Use it to check
            the <code>x-webhook-signature</code> header on each delivery.
          </p>
          <code className="secret">{secret}</code>
        </Notice>
      )}

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          setSecret(null);
          create.mutate();
        }}
      >
        <ErrorNotice error={create.error && !create.error.fieldErrors.url ? create.error : null} />
        <TextField
          label="Endpoint URL"
          type="url"
          placeholder="https://example.com/hooks/bookings"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          error={create.error?.fieldErrors.url}
          required
        />
        <fieldset className="checks">
          <legend className="field__label">Send me</legend>
          {EVENTS.map((ev) => (
            <label key={ev.value} className="check">
              <input type="checkbox" checked={events.includes(ev.value)} onChange={() => toggle(ev.value)} />
              {ev.label}
            </label>
          ))}
        </fieldset>
        <div>
          <Button variant="primary" type="submit" loading={create.isPending} disabled={!url}>
            Add webhook
          </Button>
        </div>
      </form>

      <ErrorNotice error={list.error} onRetry={list.refetch} />
      {list.data?.length > 0 && (
        <ul className="ledger ledger--compact">
          {list.data.map((w) => (
            <li key={w.id} className="ledger__row webhook-row">
              <div className="webhook-row__main">
                <p className="webhook-row__url">{w.url}</p>
                <p className="muted small">
                  {w.eventTypes.length ? w.eventTypes.map((e) => EVENTS.find((x) => x.value === e)?.label ?? e).join(', ') : 'All events'}
                </p>
              </div>
              <div className="webhook-row__actions">
                <Button size="sm" variant="ghost" onClick={() => setViewing(w)}>
                  Deliveries
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRemoving(w)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={Boolean(viewing)} onClose={() => setViewing(null)} title="Recent deliveries" size="md">
        <ErrorNotice error={deliveries.error} />
        {deliveries.data?.length === 0 && <p className="muted">Nothing sent yet.</p>}
        {deliveries.data?.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Result</th>
                  <th>Attempts</th>
                  <th>Sent</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.data.map((d) => (
                  <tr key={d.id}>
                    <td>{d.event_type}</td>
                    <td>
                      <span className={`badge badge--${d.status === 'delivered' ? 'confirmed' : 'no_show'}`}>
                        {d.status === 'delivered' ? `Delivered (${d.response_status})` : d.last_error ?? 'Failed'}
                      </span>
                    </td>
                    <td className="num">{d.attempts}</td>
                    <td>{formatStamp(d.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={() => remove.mutate(removing.id)}
        loading={remove.isPending}
        title="Remove this webhook?"
        confirmLabel="Remove webhook"
      >
        <p>{removing?.url} will stop receiving booking events.</p>
      </ConfirmDialog>
    </>
  );
}

export function AccountPage() {
  useDocumentTitle('Account');
  const { user, logout, logoutEverywhere } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirmAll, setConfirmAll] = useState(false);

  const resend = useMutation({
    mutationFn: () => authApi.resendVerification(user.email),
    onSuccess: () => toast.success(`Verification email sent to ${user.email}`),
    onError: (err) => toast.error(err.message),
  });

  const signOutAll = useMutation({
    mutationFn: logoutEverywhere,
    onSuccess: () => {
      toast.success('Signed out on every device');
      navigate('/login');
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="page page--narrow">
      <header className="page__header">
        <h1 className="page__title">Account</h1>
      </header>

      <Section title="Profile">
        <dl className="facts">
          <div>
            <dt>Email</dt>
            <dd>
              {user.email}{' '}
              {user.emailVerified ? (
                <span className="badge badge--confirmed">Confirmed</span>
              ) : (
                <span className="badge badge--pending">Not confirmed</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Account type</dt>
            <dd>{ROLE_LABEL[user.role] ?? user.role}</dd>
          </div>
          {user.provider && (
            <div>
              <dt>Your page</dt>
              <dd>
                <Link to={providerPath(user.provider.slug)}>{providerPath(user.provider.slug)}</Link>
              </dd>
            </div>
          )}
          {user.createdAt && (
            <div>
              <dt>Member since</dt>
              <dd>{formatLongDate(splitLocal(user.createdAt.split('.')[0]).date)}</dd>
            </div>
          )}
        </dl>
        {!user.emailVerified && (
          <Button onClick={() => resend.mutate()} loading={resend.isPending}>
            Resend confirmation email
          </Button>
        )}
      </Section>

      <Section title="Sessions" description="Signing out everywhere ends every session, including this one.">
        <div className="row-actions">
          <Button
            onClick={async () => {
              // Leave this signed-in-only page first, so the route guard doesn't
              // remember it as "where you were going" for the next sign-in.
              navigate('/', { replace: true });
              await logout();
            }}
          >
            <Icon name="logout" size={18} /> Sign out
          </Button>
          <Button variant="danger" onClick={() => setConfirmAll(true)}>
            Sign out everywhere
          </Button>
        </div>
      </Section>

      <Section
        title="Webhooks"
        description="Send booking events to your own systems as they happen. Each delivery is signed so you can verify it came from us."
      >
        <Webhooks />
      </Section>

      <ConfirmDialog
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        onConfirm={() => signOutAll.mutate()}
        loading={signOutAll.isPending}
        title="Sign out on every device?"
        confirmLabel="Sign out everywhere"
      >
        <p>You'll need to sign in again on this and every other device.</p>
      </ConfirmDialog>
    </div>
  );
}
