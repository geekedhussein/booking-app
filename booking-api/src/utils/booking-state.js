// ---------------------------------------------------------------------------
// BOOKING STATE MACHINE  (V2.8)
//
// Encodes the legal states and transitions ONCE, as data, instead of scattering
// if-checks. Any move not in the table is rejected — impossible states can't be
// reached. Terminal states (cancelled/completed/no_show) have no outgoing edges.
// ---------------------------------------------------------------------------

import { ValidationError } from '../errors/app-error.js';

export const BOOKING_STATES = ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'];

// Which states occupy capacity (block a slot). Terminal states free it.
export const ACTIVE_STATES = ['pending', 'confirmed'];

const TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['cancelled', 'completed', 'no_show'],
  cancelled: [],
  completed: [],
  no_show: [],
};

export function canTransition(from, to) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new ValidationError(`Cannot change a ${from} booking to ${to}`);
  }
}
