// ---------------------------------------------------------------------------
// SLOTS & OCCUPANCY
//
// Turns a day schedule from GET /resources/:id/schedule into bookable slots.
// This is a PREVIEW for the UI — it mirrors the server's rules (opening hours,
// lead time, buffer padding, capacity) so people see what's open before they
// try. The server stays authoritative: if two people pick the same last slot,
// the backend's locked capacity check decides and the loser gets a 409.
// ---------------------------------------------------------------------------

import { toMinutes, splitLocal, daysBetween, todayISO, nowMinutes } from './datetime.js';

const ALL_DAY = [{ opensAt: '00:00', closesAt: '24:00' }];

/** Opening windows for the day as [{ start, end }] in minutes. Empty = closed. */
export function openWindows(schedule) {
  const windows = schedule.hasWindows ? schedule.windows : ALL_DAY;
  return windows.map((w) => ({ start: toMinutes(w.opensAt), end: toMinutes(w.closesAt) }));
}

/** Booking intervals in minutes, optionally excluding one (the booking being moved). */
export function bookingIntervals(schedule, exclude) {
  let skipped = false;
  return schedule.bookings
    .filter((b) => {
      if (!skipped && exclude && b.startsAt === exclude.startsAt && b.endsAt === exclude.endsAt) {
        skipped = true;
        return false;
      }
      return true;
    })
    .map((b) => ({ start: splitLocal(b.startsAt).minutes, end: splitLocal(b.endsAt).minutes }));
}

/** How many bookings overlap [start, end), using the server's buffer padding. */
function overlapCount(intervals, start, end, buffer) {
  return intervals.filter((b) => b.start < end + buffer && start < b.end + buffer).length;
}

/** Duration choices allowed by the resource's policies, in minutes. */
export function durationOptions(resource, step = 30) {
  const min = Math.max(step, Math.ceil((resource.minDurationMinutes || step) / step) * step);
  const max = Math.min(resource.maxDurationMinutes || 240, 8 * 60);
  const options = [];
  for (let d = min; d <= Math.max(min, max); d += step) options.push(d);
  return options;
}

/** The duration a booking page starts on: 1 hour when allowed, else the shortest. */
export function defaultDuration(resource) {
  const options = durationOptions(resource);
  return options.includes(60) ? 60 : options[0];
}

/**
 * Candidate slots for a date and duration.
 * status: 'open' | 'full' | 'too-soon'
 */
export function buildSlots({ schedule, date, duration, leadTime = 0, step = 30, exclude }) {
  const intervals = bookingIntervals(schedule, exclude);
  const dayOffset = daysBetween(todayISO(), date) * 1440;
  const now = nowMinutes();
  const slots = [];

  for (const w of openWindows(schedule)) {
    for (let start = w.start; start + duration <= w.end; start += step) {
      const end = start + duration;
      const minutesAway = dayOffset + start - now;
      const taken = overlapCount(intervals, start, end, schedule.bufferMinutes);
      const status =
        minutesAway < leadTime ? 'too-soon' : taken >= schedule.capacity ? 'full' : 'open';
      slots.push({ start, end, status, remaining: Math.max(0, schedule.capacity - taken) });
    }
  }
  return slots;
}

/** The span the day track should draw, in minutes. */
export function trackRange(schedule) {
  const windows = openWindows(schedule);
  if (schedule.hasWindows && windows.length) {
    return {
      start: Math.min(...windows.map((w) => w.start)),
      end: Math.max(...windows.map((w) => w.end)),
    };
  }
  // Always open: show a sensible daytime span, widened to include any bookings.
  const intervals = bookingIntervals(schedule);
  const start = Math.min(7 * 60, ...intervals.map((b) => b.start));
  const end = Math.max(22 * 60, ...intervals.map((b) => b.end));
  return { start: Math.floor(start / 60) * 60, end: Math.ceil(end / 60) * 60 };
}

/**
 * Occupancy profile for the track: contiguous segments with a level 0..1
 * (share of capacity in use) — handles capacity > 1 naturally.
 */
export function occupancySegments(schedule, { start, end }, cell = 15) {
  const intervals = bookingIntervals(schedule);
  const segments = [];
  for (let t = start; t < end; t += cell) {
    const used = intervals.filter((b) => b.start < t + cell && t < b.end).length;
    const level = Math.min(1, used / schedule.capacity);
    const last = segments[segments.length - 1];
    if (last && last.level === level) last.end = t + cell;
    else segments.push({ start: t, end: t + cell, level });
  }
  return segments.filter((s) => s.level > 0);
}

/** Turnover time after each booking (the buffer), clipped to the drawn range. */
export function turnoverSegments(schedule, range) {
  if (!schedule.bufferMinutes) return [];
  const raw = bookingIntervals(schedule)
    .map((b) => ({ start: b.end, end: Math.min(b.end + schedule.bufferMinutes, range.end) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  // Merge overlaps: with capacity > 1, two bookings can end at the same minute
  // and would otherwise produce identical segments (and duplicate React keys).
  const merged = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && seg.start <= last.end) last.end = Math.max(last.end, seg.end);
    else merged.push({ ...seg });
  }
  return merged;
}

/** Closed stretches inside the drawn range (between/around windows). */
export function closedSegments(schedule, range) {
  if (!schedule.hasWindows) return [];
  const windows = openWindows(schedule).sort((a, b) => a.start - b.start);
  if (!windows.length) return [{ start: range.start, end: range.end }];
  const gaps = [];
  let cursor = range.start;
  for (const w of windows) {
    if (w.start > cursor) gaps.push({ start: cursor, end: w.start });
    cursor = Math.max(cursor, w.end);
  }
  if (cursor < range.end) gaps.push({ start: cursor, end: range.end });
  return gaps;
}

// --- booking lifecycle (client mirror of backend utils/booking-state.js) ----
// Used only to decide which buttons to show; the server enforces the rules.

const TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['cancelled', 'completed', 'no_show'],
  cancelled: [],
  completed: [],
  no_show: [],
};

export const canTransition = (from, to) => TRANSITIONS[from]?.includes(to) ?? false;
export const isActive = (status) => status === 'pending' || status === 'confirmed';

export const STATUS_LABEL = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};
