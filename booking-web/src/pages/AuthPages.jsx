import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { homeFor, useAuth } from '../auth/AuthContext.jsx';
import { pagePrefix, slugify } from '../lib/providers.js';
import { authApi } from '../lib/endpoints.js';
import { Button } from '../components/Button.jsx';
import { Field, TextField } from '../components/Field.jsx';
import { ErrorNotice, Notice, PageLoader } from '../components/Feedback.jsx';
import { useToast } from '../components/Toast.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

function AuthCard({ title, intro, children, footer }) {
  return (
    <div className="auth">
      <div className="auth__card">
        <h1 className="auth__title">{title}</h1>
        {intro && <p className="auth__intro">{intro}</p>}
        {children}
      </div>
      {footer && <p className="auth__footer">{footer}</p>}
    </div>
  );
}

/** Shared submit handling: field errors go under fields, the rest above the form. */
function useSubmit(fn) {
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }
  const fieldErrors = error?.fieldErrors ?? {};
  const formError = error && Object.keys(fieldErrors).length === 0 ? error : null;
  return { submit, submitting, fieldErrors, formError };
}

export function LoginPage() {
  useDocumentTitle('Sign in');
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Return to the page that sent them here, unless that was just the home page:
  // then each account type goes to its own home (providers: their dashboard).
  const from = location.state?.from?.pathname;
  const back = from && from !== '/' ? from : null;

  const { submit, submitting, fieldErrors, formError } = useSubmit(async () => {
    const user = await login({ email, password });
    navigate(back ?? homeFor(user), { replace: true });
  });

  return (
    <AuthCard
      title="Sign in"
      footer={
        <>
          New here? <Link to="/register" state={location.state}>Create an account</Link>
        </>
      }
    >
      <form onSubmit={submit} className="stack" noValidate>
        <ErrorNotice error={formError} />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
          required
          autoFocus
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          required
        />
        <Link to="/forgot-password" className="auth__aside">
          Forgot your password?
        </Link>
        <Button variant="primary" type="submit" loading={submitting} block>
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}

const ACCOUNT_TYPES = [
  {
    value: 'client',
    title: 'I want to book',
    body: 'Find a provider and book their time.',
  },
  {
    value: 'provider',
    title: 'I offer services',
    body: 'Get a page where clients book you.',
  },
];

export function RegisterPage() {
  useDocumentTitle('Create account');
  const { register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const toast = useToast();
  const [accountType, setAccountType] = useState(params.get('as') === 'provider' ? 'provider' : 'client');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [headline, setHeadline] = useState('');
  // The address follows the name until the person edits it themselves.
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const from = location.state?.from?.pathname;
  const isProvider = accountType === 'provider';
  const shownSlug = slugEdited ? slug : slugify(displayName);

  const { submit, submitting, fieldErrors, formError } = useSubmit(async () => {
    const body = { email, password, accountType };
    if (isProvider) {
      body.displayName = displayName;
      if (headline.trim()) body.headline = headline;
      // Only send an address the person typed; otherwise the server picks the
      // first free one based on the name (and never fails on it).
      if (slugEdited && slug) body.slug = slug;
    }
    const user = await register(body);
    toast.success(
      isProvider
        ? `Your page is ready. Add a calendar so clients can book you.`
        : `Account created. We sent a confirmation link to ${user.email}.`,
    );
    navigate(isProvider ? '/dashboard' : from ?? homeFor(user), { replace: true });
  });

  return (
    <AuthCard
      title="Create an account"
      footer={
        <>
          Already have an account? <Link to="/login" state={location.state}>Sign in</Link>
        </>
      }
    >
      <form onSubmit={submit} className="stack" noValidate>
        <fieldset className="choice" aria-label="Account type">
          {ACCOUNT_TYPES.map((t) => (
            <label key={t.value} className={`choice__option${accountType === t.value ? ' is-selected' : ''}`}>
              <input
                type="radio"
                name="accountType"
                value={t.value}
                checked={accountType === t.value}
                onChange={() => setAccountType(t.value)}
              />
              <span className="choice__title">{t.title}</span>
              <span className="choice__body">{t.body}</span>
            </label>
          ))}
        </fieldset>
        <ErrorNotice error={formError} />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
          required
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          minLength={8}
          required
        />
        {isProvider && (
          <>
            <TextField
              label="Name clients will see"
              autoComplete="organization"
              placeholder="Dr Amélie Lee"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              error={fieldErrors.displayName}
              maxLength={80}
              required
            />
            <TextField
              label="What you offer (optional)"
              placeholder="Sports physiotherapy"
              hint="One line under your name in the directory."
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              error={fieldErrors.headline}
              maxLength={160}
            />
            <SlugField
              value={shownSlug}
              onChange={(v) => {
                setSlug(v);
                setSlugEdited(true);
              }}
              error={fieldErrors.slug}
            />
          </>
        )}
        <Button variant="primary" type="submit" loading={submitting} block>
          {isProvider ? 'Create my page' : 'Create account'}
        </Button>
      </form>
    </AuthCard>
  );
}

/** Page address input with the site prefix shown in front. */
export function SlugField({ value, onChange, error, hint = 'Letters, numbers and hyphens. You can change it later.' }) {
  return (
    <Field label="Page address" hint={hint} error={error}>
      {(a11y) => (
        <div className="slug-input">
          <span className="slug-input__prefix" aria-hidden="true">
            {pagePrefix()}
          </span>
          <input
            {...a11y}
            className="slug-input__control"
            value={value}
            onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            placeholder="your-name"
            maxLength={40}
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>
      )}
    </Field>
  );
}

export function ForgotPasswordPage() {
  useDocumentTitle('Reset password');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { submit, submitting, fieldErrors, formError } = useSubmit(async () => {
    await authApi.forgotPassword(email);
    setSent(true);
  });

  if (sent) {
    return (
      <AuthCard title="Check your email" footer={<Link to="/login">Back to sign in</Link>}>
        {/* Same wording whether or not the account exists (the API never says). */}
        <p>
          If there's an account for <strong>{email}</strong>, we've sent a link to reset the
          password. It expires in an hour.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      intro="Enter your email and we'll send you a reset link."
      footer={<Link to="/login">Back to sign in</Link>}
    >
      <form onSubmit={submit} className="stack" noValidate>
        <ErrorNotice error={formError} />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
          required
          autoFocus
        />
        <Button variant="primary" type="submit" loading={submitting} block>
          Send reset link
        </Button>
      </form>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  useDocumentTitle('Choose a new password');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const toast = useToast();
  const { endSession } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState(false);

  const { submit, submitting, fieldErrors, formError } = useSubmit(async () => {
    if (password !== confirm) {
      setMismatch(true);
      return;
    }
    await authApi.resetPassword({ token, password });
    // The backend revokes every session on reset, so forget ours too.
    endSession();
    toast.success('Password updated. Sign in with your new password.');
    navigate('/login', { replace: true });
  });

  if (!token) {
    return (
      <AuthCard title="This link is incomplete" footer={<Link to="/forgot-password">Request a new link</Link>}>
        <p>Open the reset link from your email again, or request a new one.</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" intro="You'll be signed out on every device.">
      <form onSubmit={submit} className="stack" noValidate>
        <ErrorNotice error={formError} />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          minLength={8}
          required
          autoFocus
        />
        <TextField
          label="Repeat new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setMismatch(false);
          }}
          error={mismatch ? "The passwords don't match." : undefined}
          required
        />
        <Button variant="primary" type="submit" loading={submitting} block>
          Update password
        </Button>
      </form>
    </AuthCard>
  );
}

export function VerifyEmailPage() {
  useDocumentTitle('Confirm email');
  const [params] = useSearchParams();
  const token = params.get('token');
  const { user, refreshUser } = useAuth();
  const [state, setState] = useState(token ? 'working' : 'missing');
  const [error, setError] = useState(null);
  const started = useRef(false);

  // Tokens are single-use: the ref stops StrictMode's double effect from
  // sending a second request that would fail and hide the success.
  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    authApi
      .verifyEmail(token)
      .then(() => {
        setState('done');
        if (user) refreshUser().catch(() => {});
      })
      .catch((err) => {
        setError(err);
        setState('failed');
      });
  }, [token, user, refreshUser]);

  if (state === 'working') return <PageLoader label="Confirming your email" />;

  if (state === 'done') {
    return (
      <AuthCard title="Email confirmed" footer={<Link to="/">Find a time to book</Link>}>
        <Notice tone="success">Your email address is confirmed.</Notice>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="This link didn't work"
      footer={user ? <Link to="/account">Send a new link from your account</Link> : <Link to="/login">Sign in to request a new link</Link>}
    >
      <p>{error?.message ?? 'The link is missing its code.'} Links expire after 24 hours and work once.</p>
    </AuthCard>
  );
}
