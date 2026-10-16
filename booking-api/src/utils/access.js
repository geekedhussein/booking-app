// ---------------------------------------------------------------------------
// ACCESS RULES  (V3: ownership-based authorization)
//
// Two kinds of people manage calendars:
//   • platform operators (role staff/admin) — everything;
//   • providers — only the calendars they own.
// Route-level `authorize()` lets the roles in; these checks decide about the
// SPECIFIC row, because ownership depends on data, not on the token alone.
// ---------------------------------------------------------------------------

import { ForbiddenError } from '../errors/app-error.js';

export const isStaff = (user) => user?.role === 'staff' || user?.role === 'admin';

/** resourceRow comes from resourceRepo.findResourceById (carries owner_user_id). */
export const ownsResource = (user, resourceRow) =>
  user?.role === 'provider' &&
  resourceRow?.owner_user_id != null &&
  String(resourceRow.owner_user_id) === String(user.id);

export const canManageResource = (user, resourceRow) =>
  isStaff(user) || ownsResource(user, resourceRow);

export function assertCanManageResource(user, resourceRow) {
  if (!canManageResource(user, resourceRow)) {
    throw new ForbiddenError('You can only manage your own calendars');
  }
}
