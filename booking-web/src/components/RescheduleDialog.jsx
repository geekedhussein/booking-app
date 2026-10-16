import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { bookingsApi } from '../lib/endpoints.js';
import { formatLongDate, formatRange, fromMinutes, joinLocal, splitLocal } from '../lib/datetime.js';
import { Modal } from './Modal.jsx';
import { Button } from './Button.jsx';
import { SlotPicker } from './SlotPicker.jsx';
import { ErrorNotice } from './Feedback.jsx';
import { useToast } from './Toast.jsx';

/**
 * Move a booking. The picker excludes the booking's own interval from the
 * occupancy count (mirrors the backend's excludeBookingId), so "keep the same
 * time but make it longer" works on a capacity-1 resource.
 */
export function RescheduleDialog({ booking, resource, onClose }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const start = splitLocal(booking.startsAt);
  const end = splitLocal(booking.endsAt);

  const [date, setDate] = useState(start.date);
  const [duration, setDuration] = useState(end.minutes - start.minutes);
  const [selection, setSelection] = useState(null);

  const mutation = useMutation({
    mutationFn: () =>
      bookingsApi.reschedule(booking.id, {
        startsAt: joinLocal(date, selection.start),
        endsAt: joinLocal(date, selection.end),
      }),
    onSuccess: () => {
      toast.success(`Rescheduled to ${formatLongDate(date)}, ${fromMinutes(selection.start)}`);
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['schedule', String(booking.resourceId)] });
      queryClient.invalidateQueries({ queryKey: ['dayBookings', String(booking.resourceId)] });
      queryClient.invalidateQueries({ queryKey: ['audit', booking.id] });
      onClose();
    },
  });

  const onLost = useCallback(() => setSelection(null), []);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Reschedule ${resource?.name ?? 'booking'}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep current time
          </Button>
          <Button
            variant="primary"
            disabled={!selection}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {selection ? `Move to ${fromMinutes(selection.start)}` : 'Pick a new time'}
          </Button>
        </>
      }
    >
      <p className="muted">
        Currently {formatLongDate(start.date)}, {formatRange(booking.startsAt, booking.endsAt)}.
      </p>
      <ErrorNotice error={mutation.error} />
      {resource && (
        <SlotPicker
          resource={resource}
          date={date}
          onDateChange={(d) => {
            setDate(d);
            setSelection(null);
          }}
          duration={duration}
          onDurationChange={(d) => {
            setDuration(d);
            setSelection(null);
          }}
          selection={selection}
          onSelect={(s) => setSelection({ start: s.start, end: s.end })}
          onSelectionLost={onLost}
          exclude={{ startsAt: booking.startsAt, endsAt: booking.endsAt }}
        />
      )}
    </Modal>
  );
}
