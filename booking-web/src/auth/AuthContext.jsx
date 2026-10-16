import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { clearTokens, hasSession, onAuthEvent, refreshSession, setTokens } from '../lib/api.js';
import { authApi } from '../lib/endpoints.js';
import { PageLoader } from '../components/Feedback.jsx';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(hasSession() ? 'loading' : 'anonymous');
  const bootstrapped = useRef(false);

  // Restore the session on load by exchanging the stored refresh token.
  // The ref guard matters: StrictMode runs effects twice in development, and two
  // refreshes would look like token reuse to the backend.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    if (!hasSession()) return;
    refreshSession()
      .then(({ user: u }) => {
        setUser(u);
        setStatus('authenticated');
      })
      .catch(() => setStatus('anonymous'));
  }, []);

  // Keep React state in sync with the API client.
  useEffect(
    () =>
      onAuthEvent((type, payload) => {
        if (type === 'session-expired') {
          setUser(null);
          setStatus('anonymous');
          queryClient.removeQueries({ queryKey: ['me'] });
        }
        if (type === 'refreshed' && payload) setUser(payload);
      }),
    [queryClient],
  );

  const startSession = useCallback((data) => {
    setTokens(data);
    setUser(data.user);
    setStatus('authenticated');
    return data.user;
  }, []);

  const login = useCallback(async (credentials) => {
    const { data } = await authApi.login(credentials);
    return startSession(data);
  }, [startSession]);

  const register = useCallback(async (credentials) => {
    const { data } = await authApi.register(credentials);
    return startSession(data);
  }, [startSession]);

  const endSession = useCallback(() => {
    clearTokens();
    setUser(null);
    setStatus('anonymous');
    queryClient.clear();
  }, [queryClient]);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      /* revoke is best-effort; we forget the tokens either way */
    }
    endSession();
  }, [endSession]);

  const logoutEverywhere = useCallback(async () => {
    await authApi.logoutAll();
    endSession();
  }, [endSession]);

  const refreshUser = useCallback(async () => {
    const { data } = await authApi.me();
    setUser(data);
    return data;
  }, []);

  const value = useMemo(
    () => ({
      user,
      status,
      // Platform operators: manage every calendar.
      isStaff: user?.role === 'staff' || user?.role === 'admin',
      // Service providers: manage their own calendars and see their bookings.
      isProvider: user?.role === 'provider',
      // Either one gets the management screens (the API scopes what they see).
      canManage: ['staff', 'admin', 'provider'].includes(user?.role),
      login,
      register,
      logout,
      logoutEverywhere,
      endSession,
      refreshUser,
    }),
    [user, status, login, register, logout, logoutEverywhere, endSession, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Route guard: signed-in users only; remembers where they were going. */
export function RequireAuth({ children }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <PageLoader />;
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

/** Route guard: providers, staff and admins (the management screens). */
export function RequireManager({ children }) {
  const { status, canManage } = useAuth();
  if (status === 'loading') return <PageLoader />;
  if (!canManage) return <Navigate to="/" replace />;
  return children;
}

/** Route guard: service providers only (their dashboard). */
export function RequireProvider({ children }) {
  const { status, isProvider } = useAuth();
  if (status === 'loading') return <PageLoader />;
  if (!isProvider) return <Navigate to="/" replace />;
  return children;
}

/** Where someone lands after signing in, unless they were heading somewhere. */
export const homeFor = (user) => (user?.role === 'provider' ? '/dashboard' : '/');
