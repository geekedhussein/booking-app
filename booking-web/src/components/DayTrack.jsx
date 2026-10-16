import { useMemo, useRef } from 'react';
import { Icon } from './Icon.jsx';
import { addDays, daysBetween, formatDayMonth, formatWeekday, fromMinutes, todayISO, parseISODate } from '../lib/datetime.js';
import { closedSegments, occupancySegments, trackRange, turnoverSegments } from '../lib/slots.js';

// --- Date strip -------------------------------------------------------------

/** Two weeks of days as tabs, with arrows to move a week at a time. */
export function DateStrip({ value, onChange, days = 14, maxDays = 365 }) {
  const today = todayISO();
  const offset = Math.max(0, daysBetween(today, value));
  const windowStart = addDays(today, Math.floor(offset / 7) * 7);
  const dates = Array.from({ length: days }, (_, i) => addDays(windowStart, i)).filter(
    (d) => daysBetween(today, d) <= maxDays,
  );
  const canGoBack = windowStart > today;

  return (
    <div className="date-strip">
      <button
        className="icon-btn date-strip__nav"
        onClick={() => onChange(addDays(windowStart, -7) < today ? today : addDays(windowStart, -7))}
        disabled={!canGoBack}
        aria-label="Previous week"
      >
        <Icon name="chevronLeft" />
      </button>
      <div className="date-strip__days" role="tablist" aria-label="Choose a day">
        {dates.map((d) => {
          const selected = d === value;
          const weekend = [0, 6].includes(parseISODate(d).getDay());
          return (
            <button
              key={d}
              role="tab"
              aria-selected={selected}
              className={`date-chip${selected ? ' is-selected' : ''}${weekend ? ' is-weekend' : ''}`}
              onClick={() => onChange(d)}
            >
              <span className="date-chip__wd">{d === today ? 'Today' : formatWeekday(d)}</span>
              <span className="date-chip__day">{parseISODate(d).getDate()}</span>
              <span className="date-chip__mon">{formatDayMonth(d).replace(/\d+\s?/, '')}</span>
            </button>
          );
        })}
      </div>
      <button
        className="icon-btn date-strip__nav"
        onClick={() => onChange(addDays(windowStart, 7))}
        disabled={daysBetween(today, addDays(windowStart, 7)) > maxDays}
        aria-label="Next week"
      >
        <Icon name="chevronRight" />
      </button>
    </div>
  );
}

// --- Day track --------------------------------------------------------------

/**
 * The day drawn as a timeline: closed stretches hatched, bookings shaded by how
 * much of the capacity they use, the current selection in cobalt.
 * The slot buttons are the accessible control; clicking the track is a
 * pointer shortcut (onPick receives the minute that was clicked).
 */
export function DayTrack({ schedule, selection, onPick, nowMinute }) {
  const barRef = useRef(null);
  const range = useMemo(() => trackRange(schedule), [schedule]);
  const span = range.end - range.start;
  const pct = (m) => `${((m - range.start) / span) * 100}%`;
  const width = (a, b) => `${((b - a) / span) * 100}%`;

  const occupancy = useMemo(() => occupancySegments(schedule, range), [schedule, range]);
  const closed = useMemo(() => closedSegments(schedule, range), [schedule, range]);
  const turnover = useMemo(() => turnoverSegments(schedule, range), [schedule, range]);

  // Every hour gets a gridline; labels thin out on long days and small
  // screens (CSS hides .is-odd2 / .not-4 depending on width) so they never collide.
  const firstHour = Math.ceil(range.start / 60);
  const hours = [];
  for (let h = firstHour; h * 60 <= range.end; h += 1) {
    const i = h - firstHour;
    hours.push({ minute: h * 60, cls: `${i % 2 ? ' is-odd2' : ''}${i % 4 ? ' not-4' : ''}` });
  }
  const long = span > 10 * 60;

  const bookedMinutes = occupancy.reduce((sum, s) => sum + (s.end - s.start) * s.level, 0);
  const summary = schedule.hasWindows && !schedule.windows.length
    ? 'Closed this day'
    : `${fromMinutes(range.start)} to ${fromMinutes(range.end)}, about ${Math.round((bookedMinutes / span) * 100)}% booked`;

  function handleClick(e) {
    if (!onPick || !barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onPick(Math.round(range.start + ratio * span));
  }

  return (
    <figure className={`track${long ? ' track--long' : ''}`}>
      <div className="track__ticks" aria-hidden="true">
        {hours.map(({ minute, cls }) => (
          <span
            key={minute}
            className={`track__tick${cls}`}
            style={{ left: pct(minute) }}
          >
            {fromMinutes(minute)}
          </span>
        ))}
      </div>

      <div
        ref={barRef}
        className={`track__bar${onPick ? ' is-interactive' : ''}`}
        onClick={handleClick}
        role="img"
        aria-label={summary}
      >
        {hours.map(({ minute }) => (
          <span key={minute} className="track__gridline" style={{ left: pct(minute) }} />
        ))}
        {closed.map((s) => (
          <span key={`c${s.start}`} className="track__closed" style={{ left: pct(s.start), width: width(s.start, s.end) }} />
        ))}
        {turnover.map((s) => (
          <span key={`t${s.start}`} className="track__turnover" style={{ left: pct(s.start), width: width(s.start, s.end) }} />
        ))}
        {occupancy.map((s) => (
          <span
            key={`o${s.start}`}
            className={`track__busy${s.level >= 1 ? ' is-full' : ''}`}
            style={{ left: pct(s.start), width: width(s.start, s.end), '--level': s.level }}
          />
        ))}
        {nowMinute != null && nowMinute > range.start && (
          <span className="track__past" style={{ left: 0, width: width(range.start, Math.min(nowMinute, range.end)) }} />
        )}
        {nowMinute != null && nowMinute > range.start && nowMinute < range.end && (
          <span className="track__now" style={{ left: pct(nowMinute) }} />
        )}
        {selection && (
          <span
            className="track__selection"
            style={{ left: pct(selection.start), width: width(selection.start, selection.end) }}
            aria-hidden="true"
          >
            <span className="track__selection-label">{fromMinutes(selection.start)}</span>
          </span>
        )}
      </div>

      <figcaption className="track__legend">
        <span><i className="swatch swatch--open" />Open</span>
        {schedule.capacity > 1 && <span><i className="swatch swatch--busy" />Partly booked</span>}
        <span><i className="swatch swatch--full" />Full</span>
        {turnover.length > 0 && <span><i className="swatch swatch--turnover" />Turnover</span>}
        {nowMinute != null && nowMinute > range.start && <span><i className="swatch swatch--past" />Past</span>}
        {closed.length > 0 && <span><i className="swatch swatch--closed" />Closed</span>}
        {selection && <span><i className="swatch swatch--selection" />Your time</span>}
      </figcaption>
    </figure>
  );
}

/**
 * Compact, read-only track for lists: today's shape at a glance.
 * Purely visual — the text beside it carries the same information.
 */
export function MiniTrack({ schedule, nowMinute }) {
  const range = useMemo(() => trackRange(schedule), [schedule]);
  const span = range.end - range.start;
  const occupancy = useMemo(() => occupancySegments(schedule, range), [schedule, range]);
  const closed = useMemo(() => closedSegments(schedule, range), [schedule, range]);
  const pct = (m) => `${((m - range.start) / span) * 100}%`;
  const width = (a, b) => `${((b - a) / span) * 100}%`;
  return (
    <div className="mini-track" aria-hidden="true">
      <div className="mini-track__bar">
        {closed.map((x) => (
          <span key={`c${x.start}`} className="track__closed" style={{ left: pct(x.start), width: width(x.start, x.end) }} />
        ))}
        {occupancy.map((x) => (
          <span
            key={`o${x.start}`}
            className={`track__busy${x.level >= 1 ? ' is-full' : ''}`}
            style={{ left: pct(x.start), width: width(x.start, x.end), '--level': x.level }}
          />
        ))}
        {nowMinute != null && nowMinute > range.start && (
          <span className="track__past" style={{ left: 0, width: width(range.start, Math.min(nowMinute, range.end)) }} />
        )}
        {nowMinute != null && nowMinute > range.start && nowMinute < range.end && (
          <span className="mini-track__now" style={{ left: pct(nowMinute) }} />
        )}
      </div>
      <div className="mini-track__ends">
        <span>{fromMinutes(range.start)}</span>
        <span>{fromMinutes(range.end)}</span>
      </div>
    </div>
  );
}
