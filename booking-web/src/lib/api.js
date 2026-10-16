// ---------------------------------------------------------------------------
// API CLIENT
//
// One place that knows how to talk to the backend:
//   • attaches the access token, refreshing it when it's about to expire
//   • retries a request ONCE after a 401 by refreshing
//   • turns the backend error envelope { error: { code, message, details } }
//     into an ApiError that forms can read field errors from
//
// Token storage:
//   access token  → memory only (15-minute JWT; gone on reload, re-minted)
//   refresh token → localStorage, because the backend returns it in JSON.
//   localStorage is readable by any script on the page, so an XSS bug could
//   steal it. The stronger design is an httpOnly cookie set by the server; the
//   backend would need to issue one. Rotation + reuse detection (backend V2.4)
//   limits the damage of a stolen token.
// ---------------------------------------------------------------------------

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const REFRESH_KEY = 'reserve.refreshToken';

let accessToken = null;
let refreshPromise = null;
const listeners = new Set();

export class ApiError extends Error {
  constructor({ status = 0, code = 'UNKNOWN', message, details, requestId } = {}) {
    super(message || 'Something went wrong.');
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** Map validation details to { fieldName: message } for forms. */
  get fieldErrors() {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(
      this.details.filter((d) => d.field).map((d) => [d.field, d.message]),
    );
  }
}

// --- token store ------------------------------------------------------------

function readRefresh() {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export function hasSession() {
  return Boolean(readRefresh());
}

export function setTokens({ accessToken: access, refreshToken }) {
  accessToken = access ?? null;
  try {
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  } catch {
    /* storage unavailable (private mode) — session lasts until reload */
  }
}

export function clearTokens() {
  accessToken = null;
  try {
    localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* ignore */
  }
}

export function getRefreshToken() {
  return readRefresh();
}

/** Subscribe to auth events: 'session-expired' | 'refreshed'. */
export function onAuthEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = (type, payload) => listeners.forEach((fn) => fn(type, payload));

// --- refresh ----------------------------------------------------------------

function expiresSoon(token, marginMs = 30_000) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp * 1000 - Date.now() < marginMs;
  } catch {
    return true;
  }
}

async function performRefresh() {
  const refreshToken = readRefresh();
  if (!refreshToken) throw new ApiError({ status: 401, code: 'UNAUTHORIZED', message: 'Sign in to continue.' });

  const res = await fetch(`${API_BASE}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    clearTokens();
    emit('session-expired');
    throw new ApiError({ status: res.status, ...body?.error, requestId: body?.requestId });
  }
  setTokens(body.data);
  emit('refreshed', body.data.user);
  return body.data;
}

/**
 * SINGLE-FLIGHT refresh. Refresh tokens are single-use and the backend treats a
 * reused one as theft, revoking every session (V2.4). If two requests hit a 401
 * at the same moment and each refreshed independently, the second would present
 * an already-rotated token and log the user out. So every concurrent caller
 * awaits the same in-flight refresh.
 */
export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/** A usable access token, refreshing first if needed. null when signed out. */
export async function getAccessToken() {
  if (accessToken && !expiresSoon(accessToken)) return accessToken;
  if (!readRefresh()) return null;
  try {
    const { accessToken: fresh } = await refreshSession();
    return fresh;
  } catch {
    return null;
  }
}

// --- fetch wrapper ----------------------------------------------------------

function buildUrl(path, query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return `${API_BASE}/v1${path}${qs ? `?${qs}` : ''}`;
}

/**
 * Call the API. Resolves to the parsed body ({ data, pagination? }) or null for
 * 204. Rejects with ApiError.
 */
export async function api(path, { method = 'GET', body, query, headers = {}, auth = true, retry = true } = {}) {
  const token = auth ? await getAccessToken() : null;

  let res;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError({
      code: 'NETWORK',
      message: "Can't reach the server. Check your connection and try again.",
    });
  }

  // Access token rejected (expired early, revoked): refresh once and retry.
  if (res.status === 401 && auth && retry && readRefresh()) {
    try {
      await refreshSession();
    } catch {
      /* fall through to the original 401 */
    }
    if (readRefresh()) return api(path, { method, body, query, headers, auth, retry: false });
  }

  if (res.status === 204) return null;
  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError({
      status: res.status,
      ...(payload?.error ?? { message: `Request failed (${res.status}).` }),
      requestId: payload?.requestId,
    });
  }
  return payload;
}

/** WebSocket URL for live booking events. */
export function socketUrl(token) {
  const origin = API_BASE || window.location.origin;
  return `${origin.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;
}

/** Fresh idempotency key per booking attempt (backend V2.2). */
export function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
