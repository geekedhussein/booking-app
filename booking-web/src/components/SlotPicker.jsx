import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { resourcesApi } from '../lib/endpoints.js';
import { buildSlots, durationOptions } from '../lib/slots.js';
import { formatDuration, fromMinutes, nowMinutes, todayISO } from '../lib/datetime.js';
import { DateStrip, DayTrack } from './DayTrack.jsx';
import { SelectField } from './Field.jsx';
import { ErrorNotice, Spinner } from './Feedback.jsx';

const PARTS = [
  { label: 'Morning', from: 0, to: 12 * 60 },
  { label: 'Afternoon', from: 12 * 60, to: 17 * 60 },
  { label: 'Evening', from: 17 * 60, to: 24 * 60 },
];

const STATUS_TEXT = { full: 'fully booked', 'too-soon': 'too soon to book', open: 'available' };

/**
 * Pick a date, a duration and a start time for one resource.
 * `exclude` is the booking being rescheduled, so its own slot doesn't count as taken.
 */
export function SlotPicker({
  resource,
  date,
  onDateChange,
  duration,
  onDurationChange,
  selection,
  onSelect,
  onSelectionLost,
  exclude,
}) {
  const schedule = useQuery({
    queryKey: ['schedule', String(resource.id), date],
    queryFn: () => resourcesApi.schedule(resource.id, date).then((r) => r.data),
    placeholderData: (prev) => (prev?.date === date ? prev : undefined),
  });

  // Always include the current duration (e.g. an existing 45-minute booking
  // being rescheduled) so the select never shows a value that isn't selected.
  const durations = useMemo(() => {
    const options = durationOptions(resource);
    return options.includes(duration) ? options : [...options, duration].sort((a, b) => a - b);
  }, [resource, duration]);

  const slots = useMemo(
    () =>
      schedule.data
        ? buildSlots({
            schedule: schedule.data,
            date,
            duration,
            leadTime: resource.leadTimeMinutes,
            exclude,
          })
        : [],
    [schedule.data, date, duration, resource.leadTimeMinutes, exclude],
  );

  // If the selected time stops being available (someone else booked it and a
  // live update redrew the schedule), let the parent react.
  useEffect(() => {
    if (!selection || !schedule.data || schedule.isFetching) return;
    const stillOpen = slots.some(
      (s) => s.start === selection.start && s.end === selection.end && s.status === 'open',
    );
    if (!stillOpen) onSelectionLost?.();
  }, [slots, selection, schedule.data, schedule.isFetching, onSelectionLost]);

  const openCount = slots.filter((s) => s.status === 'open').length;
  const closedAllDay = schedule.data?.hasWindows && schedule.data.windows.length === 0;
  const showRemaining = resource.capacity > 1;

  function pickNearest(minute) {
    const candidates = slots.filter((s) => s.status === 'open');
    if (!candidates.length) return;
    const nearest = candidates.reduce((best, s) =>
      Math.abs(s.start - minute) < Math.abs(best.start - minute) ? s : best,
    );
    onSelect(nearest);
  }

  return (
    <section className="picker" aria-label="Choose a time">
      <DateStrip value={date} onChange={onDateChange} />

      <div className="picker__controls">
        <SelectField
          label="Duration"
          value={duration}
          onChange={(e) => onDurationChange(Number(e.target.value))}
          className="picker__duration"
        >
          {durations.map((d) => (
            <option key={d} value={d}>
              {formatDuration(d)}
            </option>
          ))}
        </SelectField>
        <p className="picker__count" aria-live="polite">
          {schedule.isFetching && <Spinner size={14} />}
          {!schedule.isLoading && !closedAllDay && `${openCount} ${openCount === 1 ? 'time' : 'times'} open`}
        </p>
      </div>

      {schedule.error && <ErrorNotice error={schedule.error} onRetry={() => schedule.refetch()} />}

      {schedule.data && (
        <DayTrack
          schedule={schedule.data}
          selection={selection}
          onPick={pickNearest}
          nowMinute={date === todayISO() ? nowMinutes() : null}
        />
      )}

      {schedule.isLoading && <div className="picker__skeleton" aria-hidden="true" />}

      {schedule.data && closedAllDay && (
        <p className="picker__empty">Closed on this day. Pick another date.</p>
      )}

      {schedule.data && !closedAllDay && openCount === 0 && (
        <p className="picker__empty">
          Nothing open for {formatDuration(duration)} on this day. Try a shorter duration or another date.
        </p>
      )}

      {schedule.data && !closedAllDay && slots.length > 0 && (
        <div className="slot-groups">
          {PARTS.map((part) => {
            const group = slots.filter((s) => s.start >= part.from && s.start < part.to);
            if (!group.some((s) => s.status === 'open')) return null;
            return (
              <div key={part.label} className="slot-group">
                <h3 className="slot-group__title">{part.label}</h3>
                <div className="slot-grid">
                  {group.map((s) => {
                    const selected = selection?.start === s.start && selection?.end === s.end;
                    return (
                      <button
                        key={s.start}
                        className={`slot slot--${s.status}${selected ? ' is-selected' : ''}`}
                        disabled={s.status !== 'open'}
                        aria-pressed={selected}
                        aria-label={`${fromMinutes(s.start)} to ${fromMinutes(s.end)}, ${STATUS_TEXT[s.status]}${
                          showRemaining && s.status === 'open' ? `, ${s.remaining} of ${resource.capacity} places left` : ''
                        }`}
                        onClick={() => onSelect(s)}
                      >
                        <span className="slot__time">{fromMinutes(s.start)}</span>
                        {showRemaining && s.status === 'open' && s.remaining < resource.capacity && (
                          <span className="slot__left">{s.remaining} left</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
