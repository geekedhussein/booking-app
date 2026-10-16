import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { providersApi } from '../lib/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { Button } from '../components/Button.jsx';
import { Icon } from '../components/Icon.jsx';
import { EmptyState, ErrorNotice, Notice, PageLoader } from '../components/Feedback.jsx';
import { CalendarList, Monogram } from './ResourcesPage.jsx';
import { ResourceDetailPage } from './ResourceDetailPage.jsx';

/**
 * A provider's Reserve page (/p/:slug): who they are, then their calendars.
 * With a single calendar there's nothing to choose, so the page goes straight
 * to picking a time.
 */
export function ProviderPage() {
  const { slug } = useParams();
  const { user } = useAuth();
  const { data: provider, isLoading, error, refetch } = useQuery({
    queryKey: ['provider', slug],
    queryFn: () => providersApi.page(slug).then((r) => r.data),
  });
  useDocumentTitle(provider?.displayName);

  if (isLoading) return <PageLoader />;
  if (error) {
    return (
      <div className="page">
        {error.status === 404 ? (
          <EmptyState title="There's no page at this address" action={<Button to="/">Find a provider</Button>}>
            The link may be mistyped, or the provider changed their address.
          </EmptyState>
        ) : (
          <ErrorNotice error={error} onRetry={refetch} />
        )}
      </div>
    );
  }

  const isOwner = user?.provider?.slug === provider.slug;
  const calendars = provider.calendars;

  return (
    <div className={`page${calendars.length === 1 ? ' page--booking' : ''}`}>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/">Find</Link>
        <Icon name="chevronRight" size={14} />
        <span aria-current="page">{provider.displayName}</span>
      </nav>

      {isOwner && (
        <Notice tone="info" action={<Button size="sm" to="/dashboard">Dashboard</Button>}>
          This is your page, as clients see it.
        </Notice>
      )}

      <header className="provider-head">
        <Monogram name={provider.displayName} size="lg" />
        <div>
          <h1 className="page__title">{provider.displayName}</h1>
          {provider.headline && <p className="provider-head__headline">{provider.headline}</p>}
        </div>
      </header>

      {calendars.length === 0 && (
        <EmptyState title="Not taking bookings right now">
          {isOwner ? 'Add a calendar from your dashboard so clients can book you.' : 'Check back later.'}
        </EmptyState>
      )}

      {calendars.length === 1 && <ResourceDetailPage resourceId={String(calendars[0].id)} embedded />}

      {calendars.length > 1 && (
        <section aria-labelledby="calendars-title">
          <h2 id="calendars-title" className="section-title">
            Choose what to book
          </h2>
          <CalendarList calendars={calendars} />
        </section>
      )}
    </div>
  );
}
