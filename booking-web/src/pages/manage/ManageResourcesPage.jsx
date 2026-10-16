import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { resourcesApi } from '../../lib/endpoints.js';
import { describeRules } from '../../lib/rules.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { useManagedCalendars } from '../../hooks/useManagedCalendars.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Button } from '../../components/Button.jsx';
import { Icon } from '../../components/Icon.jsx';
import { EmptyState, ErrorNotice } from '../../components/Feedback.jsx';
import { useToast } from '../../components/Toast.jsx';

export function ManageResourcesPage() {
  useDocumentTitle('Calendars');
  const { isProvider } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  // A provider's own calendars, or every calendar for staff.
  const { data, isLoading, error, refetch } = useManagedCalendars();

  const toggle = useMutation({
    mutationFn: (r) => resourcesApi.update(r.id, { isActive: !r.isActive }),
    onSuccess: ({ data: r }) => {
      toast.success(r.isActive ? `${r.name} is taking bookings again` : `Bookings paused for ${r.name}`);
      queryClient.invalidateQueries({ queryKey: ['resources'] });
      queryClient.invalidateQueries({ queryKey: ['resource', String(r.id)] });
      queryClient.invalidateQueries({ queryKey: ['provider'] });
      queryClient.invalidateQueries({ queryKey: ['providers'] });
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Calendars</h1>
          <p className="page__lede">
            {isProvider
              ? 'Each calendar is something clients can book on your page.'
              : 'Every calendar on Reserve, across all providers.'}
          </p>
        </div>
        <Button to="/manage/resources/new" variant="primary" size="sm">
          <Icon name="plus" size={18} /> Add calendar
        </Button>
      </header>

      <ErrorNotice error={error} onRetry={refetch} />
      {isLoading && <div className="table-skeleton" aria-hidden="true" />}

      {data?.length === 0 && (
        <EmptyState
          title="No calendars yet"
          action={<Button to="/manage/resources/new" variant="primary">Add your first calendar</Button>}
        >
          A calendar is what clients book: your time, a room, a court.
        </EmptyState>
      )}

      {data?.length > 0 && (
        <div className="table-wrap">
          <table className="table table--responsive">
            <thead>
              <tr>
                <th>Name</th>
                {!isProvider && <th>Provider</th>}
                <th>Capacity</th>
                <th>Rules</th>
                <th>Status</th>
                <th><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className={r.isActive ? '' : 'is-muted'}>
                  <td data-label="Name">
                    <Link to={`/manage/resources/${r.id}`} className="table__primary">
                      {r.name}
                    </Link>
                  </td>
                  {!isProvider && <td data-label="Provider">{r.providerName ?? 'Unassigned'}</td>}
                  <td data-label="Capacity" className="num">{r.capacity}</td>
                  <td data-label="Rules" className="table__rules">{describeRules(r)}</td>
                  <td data-label="Status">
                    <span className={`badge ${r.isActive ? 'badge--confirmed' : 'badge--cancelled'}`}>
                      {r.isActive ? 'Taking bookings' : 'Paused'}
                    </span>
                  </td>
                  <td className="table__actions">
                    <Button size="sm" variant="ghost" to={`/manage/resources/${r.id}`}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggle.mutate(r)}
                      loading={toggle.isPending && toggle.variables?.id === r.id}
                    >
                      {r.isActive ? 'Pause bookings' : 'Resume bookings'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
