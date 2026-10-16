// ---------------------------------------------------------------------------
// BOOKING RULES VALIDATOR  (V2.6 → Part IV semantic validation)
//
// Pure function (easy to unit test): given a resource's policies + availability
// windows and a requested interval, throw ValidationError if any rule is broken.
// The buffer is NOT checked here: it's part of the overlap count in the booking
// service's locked transaction (bookingRepo.countOverlappingActive).
// Times are naive local wall-clock (no timezones).
// ---------------------------------------------------------------------------

import { ValidationError } from '../errors/app-error.js';

const toDate = (canonical) => new Date(canonical.replace(' ', 'T'));
const minutesSinceMidnight = (timeStr) => {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
};

export function validateBookingAgainstRules({ resource, windows, startsAt, endsAt }) {
  const start = toDate(startsAt);
  const end = toDate(endsAt);
  const durationMinutes = (end - start) / 60000;

  // Duration bounds.
  if (resource.min_duration_minutes && durationMinutes < resource.min_duration_minutes) {
    throw new ValidationError(
      `Minimum booking duration is ${resource.min_duration_minutes} minutes`,
    );
  }
  if (resource.max_duration_minutes && durationMinutes > resource.max_duration_minutes) {
    throw new ValidationError(
      `Maximum booking duration is ${resource.max_duration_minutes} minutes`,
    );
  }

  // Lead time: must start at least N minutes from now (stricter than "future").
  if (resource.lead_time_minutes) {
    const earliest = Date.now() + resource.lead_time_minutes * 60000;
    if (start.getTime() < earliest) {
      throw new ValidationError(
        `Bookings must be made at least ${resource.lead_time_minutes} minutes in advance`,
      );
    }
  }

  // Availability windows only apply to a single day; require same-day interval.
  if (startsAt.slice(0, 10) !== endsAt.slice(0, 10)) {
    throw new ValidationError('A booking must start and end on the same day');
  }

  // If the resource has any windows, the interval must fit inside one for that
  // day of week. No windows at all = always available (backward compatible).
  if (windows.length > 0) {
    const dow = start.getDay(); // 0=Sun..6=Sat, local
    const startMin = start.getHours() * 60 + start.getMinutes();
    const endMin = end.getHours() * 60 + end.getMinutes();
    const fits = windows.some(
      (w) =>
        w.day_of_week === dow &&
        minutesSinceMidnight(w.opens_at) <= startMin &&
        minutesSinceMidnight(w.closes_at) >= endMin,
    );
    if (!fits) {
      throw new ValidationError("Requested time is outside the resource's available hours");
    }
  }
}
