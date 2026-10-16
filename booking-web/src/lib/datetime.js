// ---------------------------------------------------------------------------
// LOCAL DATE/TIME HELPERS
//
// The backend stores naive wall-clock times ("2026-10-06 10:00:00") with no
// timezone. The browser must therefore NEVER route these through UTC:
// Date.prototype.toISOString() converts to UTC and would shift every booking by
// the user's offset. Everything here builds strings from local components.
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');

export function toISODate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO() {
  return toISODate(new Date());
}

export function addDays(iso, n) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function daysBetween(fromIso, toIso) {
  return Math.round((parseISODate(toIso) - parseISODate(fromIso)) / 86_400_000);
}

/** "HH:MM[:SS]" → minutes since midnight. "24:00" → 1440. */
export function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** minutes since midnight → "HH:MM" */
export function fromMinutes(mins) {
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}

/** "YYYY-MM-DD HH:MM:SS" → { date, time, minutes } */
export function splitLocal(dateTime) {
  const [date, time = '00:00:00'] = dateTime.split(' ');
  return { date, time: time.slice(0, 5), minutes: toMinutes(time) };
}

/** Build the string the API expects. */
export function joinLocal(date, minutes) {
  return `${date} ${fromMinutes(minutes)}`;
}

export function nowMinutes() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

/** Canonical local "now" — compares correctly against API strings lexically. */
export function nowLocal() {
  const n = new Date();
  return `${toISODate(n)} ${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;
}

const fmt = (opts) => new Intl.DateTimeFormat(undefined, opts);
const dayShort = fmt({ weekday: 'short' });
const dayMonth = fmt({ day: 'numeric', month: 'short' });
const longDate = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const longDateYear = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const formatWeekday = (iso) => dayShort.format(parseISODate(iso));
export const formatDayMonth = (iso) => dayMonth.format(parseISODate(iso));

export function formatLongDate(iso) {
  const d = parseISODate(iso);
  return (d.getFullYear() === new Date().getFullYear() ? longDate : longDateYear).format(d);
}

/** Friendly relative day: Today / Tomorrow / long date. */
export function formatRelativeDay(iso) {
  const diff = daysBetween(todayISO(), iso);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return formatLongDate(iso);
}

/** "10:00–11:30" */
export function formatRange(startsAt, endsAt) {
  return `${splitLocal(startsAt).time}–${splitLocal(endsAt).time}`;
}

/** 90 → "1 h 30 min" */
export function formatDuration(mins) {
  if (mins == null) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Timestamp from the API ("2026-10-06 09:12:44.123") → "6 Oct, 09:12" */
export function formatStamp(stamp) {
  if (!stamp) return '';
  const { date, time } = splitLocal(stamp.split('.')[0]);
  return `${formatDayMonth(date)}, ${time}`;
}
