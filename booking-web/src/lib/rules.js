import { formatDuration } from './datetime.js';

/** A resource's booking rules as one plain sentence. */
export function describeRules(r) {
  const parts = [];
  const min = r.minDurationMinutes || 0;
  const max = r.maxDurationMinutes;
  if (min && max && min === max) parts.push(`${formatDuration(min)} per booking`);
  else if (min && max) parts.push(`${formatDuration(min)} to ${formatDuration(max)} per booking`);
  else if (max) parts.push(`up to ${formatDuration(max)} per booking`);
  else if (min) parts.push(`at least ${formatDuration(min)} per booking`);
  if (r.leadTimeMinutes) parts.push(`book ${formatDuration(r.leadTimeMinutes)} ahead`);
  if (r.bufferMinutes) parts.push(`${formatDuration(r.bufferMinutes)} turnover between bookings`);
  if (!parts.length) return 'Book any length, any time it’s open.';
  const s = parts.join(', ');
  return `${s[0].toUpperCase()}${s.slice(1)}.`;
}

export function describeCapacity(capacity) {
  return capacity > 1 ? `Up to ${capacity} bookings at once` : 'One booking at a time';
}
