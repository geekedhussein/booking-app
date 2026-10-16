import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext.jsx';
import { providersApi, resourcesApi } from '../lib/endpoints.js';

/**
 * The calendars the signed-in person manages: a provider's own (including
 * paused ones), or every calendar for staff. Keyed under 'resources' so any
 * existing invalidation of resource lists refreshes it too.
 */
export function useManagedCalendars() {
  const { user, isProvider } = useAuth();
  return useQuery({
    queryKey: ['resources', 'managed', user?.id],
    queryFn: () =>
      isProvider
        ? providersApi.mine().then((r) => r.data.calendars)
        : resourcesApi.list({ activeOnly: false }).then((r) => r.data),
    enabled: Boolean(user),
  });
}
