// ---------------------------------------------------------------------------
// LOCAL DATE-TIME HELPER  (our "no timezones" decision, at the input boundary)
//
// We accept wall-clock date-times with NO timezone: "YYYY-MM-DD HH:MM[:SS]" or
// with a "T" separator. We validate that the string is a REAL calendar moment
// (rejecting 2026-02-30, hour 25, etc.) and normalize it to one canonical form
// "YYYY-MM-DD HH:MM:SS", which the database stores verbatim as a string. No
// conversion, ever — the string the client sends is the wall-clock time we store
// and return. The fixed width also makes string order equal time order, which
// the booking queries rely on (see db/index.js, "two kinds of time").
// ---------------------------------------------------------------------------

const LOCAL_DT = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * @param {string} value
 * @returns {string | null} canonical "YYYY-MM-DD HH:MM:SS", or null if invalid.
 */
export function parseLocalDateTime(value) {
  const m = LOCAL_DT.exec(value);
  if (!m) return null;

  const [, y, mo, d, h, mi, s = '00'] = m;

  // Build a LOCAL Date (date-time strings without a timezone are parsed as local
  // per the JS spec) purely to validate the calendar math.
  const dt = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`);
  if (Number.isNaN(dt.getTime())) return null;

  // Guard against silent rollover: Date accepts "2026-02-30" by rolling it to
  // Mar 2, so we confirm every component survived unchanged.
  if (
    dt.getFullYear() !== Number(y) ||
    dt.getMonth() + 1 !== Number(mo) ||
    dt.getDate() !== Number(d) ||
    dt.getHours() !== Number(h) ||
    dt.getMinutes() !== Number(mi) ||
    dt.getSeconds() !== Number(s)
  ) {
    return null;
  }

  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

/** Compare two canonical local date-times as wall-clock instants. */
export function isBefore(aCanonical, bCanonical) {
  return new Date(aCanonical.replace(' ', 'T')) < new Date(bCanonical.replace(' ', 'T'));
}
