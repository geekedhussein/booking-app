// ---------------------------------------------------------------------------
// ENDPOINTS — one function per backend route. Components never build URLs.
// ---------------------------------------------------------------------------

import { api, getRefreshToken } from './api.js';

const post = (path, body, opts) => api(path, { method: 'POST', body, ...opts });

export const authApi = {
  register: (body) => post('/auth/register', body, { auth: false }),
  login: (body) => post('/auth/login', body, { auth: false }),
  logout: () => post('/auth/logout', { refreshToken: getRefreshToken() ?? '' }, { auth: false }),
  logoutAll: () => post('/auth/logout-all'),
  me: () => api('/auth/me'),
  verifyEmail: (token) => post('/auth/verify-email', { token }, { auth: false }),
  resendVerification: (email) => post('/auth/resend-verification', { email }, { auth: false }),
  forgotPassword: (email) => post('/auth/forgot-password', { email }, { auth: false }),
  resetPassword: (body) => post('/auth/reset-password', body, { auth: false }),
};

// V3: service providers — the public directory, each provider's page, and the
// signed-in provider's own profile, calendars and bookings.
export const providersApi = {
  directory: ({ q } = {}) => api('/providers', { auth: false, query: { q: q || undefined } }),
  page: (slug) => api(`/providers/${encodeURIComponent(slug)}`, { auth: false }),
  mine: () => api('/providers/me'),
  updateMine: (body) => api('/providers/me', { method: 'PATCH', body }),
  bookings: ({ from, to, status } = {}) =>
    api('/providers/me/bookings', { query: { from, to, status } }),
};

export const resourcesApi = {
  list: ({ activeOnly = true, limit = 100 } = {}) =>
    api('/resources', { auth: false, query: { activeOnly: String(activeOnly), limit } }),
  get: (id) => api(`/resources/${id}`, { auth: false }),
  create: (body) => post('/resources', body),
  update: (id, body) => api(`/resources/${id}`, { method: 'PATCH', body }),
  availability: (id) => api(`/resources/${id}/availability`, { auth: false }),
  setAvailability: (id, windows) =>
    api(`/resources/${id}/availability`, { method: 'PUT', body: { windows } }),
  schedule: (id, date) => api(`/resources/${id}/schedule`, { auth: false, query: { date } }),
  dayBookings: (id, date) => api(`/resources/${id}/bookings`, { query: { date } }),
};

export const bookingsApi = {
  create: (body, idempotencyKey) =>
    post('/bookings', body, { headers: { 'Idempotency-Key': idempotencyKey } }),
  listMine: ({ cursor, status, limit = 20 }) =>
    api('/bookings/me', { query: { paginate: 'cursor', cursor, status, limit } }),
  reschedule: (id, body) => api(`/bookings/${id}`, { method: 'PATCH', body }),
  cancel: (id) => api(`/bookings/${id}`, { method: 'DELETE' }),
  confirm: (id) => post(`/bookings/${id}/confirm`),
  complete: (id) => post(`/bookings/${id}/complete`),
  noShow: (id) => post(`/bookings/${id}/no-show`),
  audit: (id) => api(`/bookings/${id}/audit`),
};

export const webhooksApi = {
  list: () => api('/webhooks'),
  create: (body) => post('/webhooks', body),
  remove: (id) => api(`/webhooks/${id}`, { method: 'DELETE' }),
  deliveries: (id) => api(`/webhooks/${id}/deliveries`),
};
