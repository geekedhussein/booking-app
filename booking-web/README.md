# Reserve — booking frontend

React frontend for the Booking API. **Clients** find a service provider and
book a time. **Service providers** get a public page, set up the calendars
clients book, and run their bookings from a dashboard.

React 19 · Vite · React Router 7 · TanStack Query 5. Plain CSS with design
tokens, no UI framework.

## Run it

You need the backend running (see `../booking-api`), including the **relay**
process — live updates and emails travel through the outbox.

```bash
# backend, in ../booking-api (separate terminals)
npm run dev
npm run relay
npm run worker      # emails: verification, reset, confirmations, reminders

# frontend, here
npm install
npm run dev         # http://localhost:5173
```

In development Vite proxies `/v1`, `/ws` and `/docs` to `http://localhost:3000`,
so the browser only ever talks to one origin and there's no CORS to configure.

Set **`APP_BASE_URL=http://localhost:5173`** in the backend's `.env` so the
links in verification and reset emails open this app. In development the worker
doesn't send real email; it logs each message with its link — copy the link from
the worker's output.

Sign up as a service provider from the app (*I offer services*). To make
yourself a platform operator who can manage every calendar, register, then in
MongoDB (`docker compose exec mongo mongosh booking`):
`db.users.updateOne({ email: 'you@example.com' }, { $set: { role: 'staff' } })`
and sign in again. (`npm run seed` in the API also creates `staff@example.com`.)

### Whole stack in Docker

Unzip `booking-api` and `booking-web` side by side, then from `booking-api`:

```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose up --build
```

Open **http://localhost:8080**. nginx serves the built app and proxies `/v1`,
`/ws` and `/docs` to the API.

### Other commands

```bash
npm run build     # production build into dist/
npm run preview   # serve the build locally (with the same proxy)
npm run lint
```

If the frontend is served from a different origin than the API, set
`VITE_API_URL` (see `.env.example`) and add that origin to the backend's
`CORS_ORIGINS`.

## What's in it

**Sign-up** asks one question first: *I want to book* (client) or *I offer
services* (provider). Providers also give the name clients see, an optional
line about what they offer, and a page address suggested from the name.

**Clients** — a searchable directory of providers; each provider's page at
`/p/:slug` (with one calendar it goes straight to booking; with several, each
shows today's availability); a booking page built around the day track; My
bookings (reschedule, cancel, history), each naming and linking its provider;
account settings, email confirmation, password reset, signing out everywhere,
and webhooks for developers.

**Service providers** — a dashboard with their shareable link and every booking
across their calendars, grouped by day and updating live, with the actions each
status allows (*Mark completed* / *Mark no-show* once a booking has started);
editing their page (name, line, address); a day schedule per calendar; adding
and editing calendars, their booking rules and weekly opening hours.

**Staff** (platform operators) — the same Schedule and Calendars screens across
every provider, with a Provider column.

Responsive down to 360px wide (bottom tab bar and a docked booking summary on
phones), light and dark themes, keyboard accessible, reduced motion respected.

## Structure

```
src/
  lib/          api client, endpoints, local date helpers, slot maths, rule copy
  auth/         session state and route guards
  hooks/        live booking socket, theme, document title
  components/   primitives (Button, Field, Modal, Toast…) and the booking
                pieces (DayTrack, DateStrip, SlotPicker, RescheduleDialog…)
  pages/        one file per screen; provider/staff screens in pages/manage/
  styles/       tokens.css → base.css → components.css → pages.css
```

Pages call functions in `lib/endpoints.js`; nothing else builds URLs. Server
state lives in TanStack Query; the only app-wide client state is the session.

## Decisions worth knowing

These mirror guarantees the backend makes. Changing them can break those
guarantees, so read this before refactoring.

**Times never go through UTC.** The API uses naive local wall-clock strings
(`"2026-10-06 10:00:00"`). `Date.prototype.toISOString()` converts to UTC and
would shift every booking by the user's offset, so `lib/datetime.js` builds
strings from local date parts only. Don't use `toISOString` for booking times.

**Token refresh is single-flight.** Access tokens last 15 minutes; refresh
tokens are single-use, and the backend treats a reused one as theft and revokes
every session. Two requests refreshing at once would trip that, so all callers
share one in-flight refresh (`refreshSession` in `lib/api.js`). For the same
reason, the session bootstrap and the email verification call are guarded
against React StrictMode's double effects.

**One idempotency key per booking attempt.** The key is created on the first
click and reused if that attempt is retried after a network failure, so a lost
response can't create a second booking. It resets when the selection changes or
the server gives a final answer.

**Slot availability is a preview.** `lib/slots.js` applies the server's rules
(opening hours, lead time, turnover buffer, capacity) to show what's open. The
server stays authoritative: if two people take the last slot at once, one gets a
`409` and the page explains that the time was just taken.

**Live updates invalidate, they don't patch.** A WebSocket event triggers a
refetch of the affected schedule rather than editing cached data by hand. Every
reconnect fetches a fresh access token, because the token is only checked at the
handshake.

**The refresh token is in localStorage.** The backend returns it in the response
body, so that's the only option today. An XSS bug could read it; the stronger
design is an httpOnly cookie set by the server. Rotation and reuse detection
limit the damage meanwhile.

## Design

A members' club front desk rather than a transit board: calm, refined, with the
hierarchy carried by type instead of chrome.

- **Type.** Source Serif 4 (with optical sizes, so large headings get display
  letterforms) for headings and every booking time; Schibsted Grotesk for
  interface text. Both are **self-hosted** through `@fontsource-variable`, so
  there's no request to a font CDN, visitor IPs aren't shared, and they work
  offline or behind a strict CSP. Browsers download only the Latin subset
  (about 170 KB) unless a page needs other scripts.
- **Color carries one meaning each.** Pine `#1E5B47` is you: your selection,
  your bookings, the primary action. Lilac `#A7ABEE` is booked. Amber appears
  only for *pending*. Mist `#F4F6F5` and green-black ink `#18211D` everywhere
  else. Tokens are named by meaning (`--accent`, `--booked`, `--pending`), so a
  palette change touches `styles/tokens.css` only.
- **The day track** is the signature element: a capsule timeline with bookings
  shaded by how much capacity they use, turnover and past time tinted, closed
  hours hatched, and your selection as a labelled pill. A compact version on the
  home page shows each resource's day and its next free time, so you see
  availability before choosing.
- **Restraint.** Statuses are a dot and a word, not filled pills. Rows are
  ledger lines on one panel, not identical cards. Radius follows hierarchy
  (10px controls, 18px panels). Shadows only on things that float.

## Verified

Driven end to end in Chromium against the real backend (database, Redis, API
and relay), 44 checks. This run was made when the backend used PostgreSQL; the
MongoDB version has so far been exercised by hand, so rerun these checks after
any backend change:

- browse, sign in, pick a slot, book; the booked slot becomes unavailable
- the Live indicator connects; another user's booking redraws an open page
  without a reload
- My bookings lists, filters by status, opens history, reschedules and cancels
  with matching toasts; Escape closes dialogs
- a new provider signs up, gets an address from their name, lands on the
  dashboard, adds a calendar with opening hours, and appears in the directory;
  taking another provider's address is refused in the form
- the directory search finds providers by what they offer; a one-calendar page
  books directly; a multi-calendar page lists its calendars
- a client books from a provider page; My bookings links each provider
- the provider's dashboard shows only their bookings, receives a new one live,
  cancels, and marks a started booking completed; their Schedule offers only
  their calendars; another provider's calendar is read-only
- staff see every calendar with its provider
- on a 390px phone: bottom tab bar (with Dashboard, Schedule and Calendars for
  providers), no top nav, docked booking summary, and no horizontal scrolling
  on the directory, provider pages, sign-up, dashboard, calendars or schedule
- signing out and back in lands each account type on its own home
- the self-hosted fonts load, and no request goes to Google Fonts

That run caught a backend bug: the first page of cursor pagination
(`?paginate=cursor`) was rejected by the strict query schema. It's fixed in the
backend with a regression test.
