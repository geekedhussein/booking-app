import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTheme } from '../hooks/useTheme.js';
import { authApi } from '../lib/endpoints.js';
import { Icon } from './Icon.jsx';
import { IconButton } from './Button.jsx';
import { useToast } from './Toast.jsx';

/**
 * Navigation by account type:
 *   client   → Find, My bookings
 *   provider → Dashboard, Schedule, Calendars (they run a page; booking others
 *              is still possible from the directory link in their dashboard)
 *   staff    → Find, My bookings, Schedule, Calendars (every calendar)
 */
function navItems(user) {
  const find = { to: '/', label: 'Find', icon: 'search', end: true };
  const mine = { to: '/bookings', label: 'My bookings', short: 'Bookings', icon: 'list' };
  const schedule = { to: '/manage/schedule', label: 'Schedule', icon: 'clock' };
  const calendars = { to: '/manage', label: 'Calendars', icon: 'grid', end: true };
  if (!user) return [find];
  if (user.role === 'provider') {
    return [{ to: '/dashboard', label: 'Dashboard', icon: 'home' }, schedule, calendars];
  }
  if (user.role === 'staff' || user.role === 'admin') return [find, mine, schedule, calendars];
  return [find, mine];
}

function VerifyBanner() {
  const { user } = useAuth();
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [hidden, setHidden] = useState(false);
  if (!user || user.emailVerified || hidden) return null;

  async function resend() {
    setSending(true);
    try {
      await authApi.resendVerification(user.email);
      toast.success(`Verification email sent to ${user.email}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="banner" role="status">
      <p>
        Confirm <strong>{user.email}</strong> using the link we emailed you.
      </p>
      <div className="banner__actions">
        <button className="link-btn" onClick={resend} disabled={sending}>
          {sending ? 'Sending…' : 'Resend email'}
        </button>
        <IconButton label="Hide" onClick={() => setHidden(true)}>
          <Icon name="x" size={16} />
        </IconButton>
      </div>
    </div>
  );
}

export function Layout() {
  const { user, status } = useAuth();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const items = navItems(user);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="topbar">
        <div className="topbar__inner">
          <Link to={user?.role === 'provider' ? '/dashboard' : '/'} className="brand" aria-label="Reserve home">
            <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true">
              <rect x="2" y="12" width="28" height="8" rx="4" className="brand__rail" />
              <rect x="2" y="12" width="12" height="8" rx="4" className="brand__busy" />
              <rect x="16" y="8" width="8" height="16" rx="4" className="brand__pick" />
            </svg>
            <span className="brand__name">Reserve</span>
          </Link>

          <nav className="topnav" aria-label="Main">
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className="topnav__link">
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="topbar__actions">
            <IconButton label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} onClick={toggle}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </IconButton>
            {status !== 'loading' &&
              (user ? (
                <NavLink to="/account" className="account-chip" aria-label="Account">
                  <span className="account-chip__avatar" aria-hidden="true">
                    {user.email[0].toUpperCase()}
                  </span>
                  <span className="account-chip__email">{user.email}</span>
                </NavLink>
              ) : (
                <Link to="/login" state={{ from: location }} className="btn btn--primary btn--sm">
                  <span className="btn__label">Sign in</span>
                </Link>
              ))}
          </div>
        </div>
      </header>

      <VerifyBanner />

      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>

      {/* Phones: primary navigation at the bottom, within thumb reach. */}
      <nav className="tabbar" aria-label="Main">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="tabbar__link">
            <Icon name={item.icon} size={22} />
            <span>{item.short ?? item.label}</span>
          </NavLink>
        ))}
        <NavLink to={user ? '/account' : '/login'} className="tabbar__link">
          <Icon name="user" size={22} />
          <span>{user ? 'Account' : 'Sign in'}</span>
        </NavLink>
      </nav>
    </div>
  );
}
