// ---------------------------------------------------------------------------
// PROVIDER SERVICE  (V3)
//
// Profiles (the public Reserve page at /p/<slug>), the public directory, and
// the provider's own dashboard data. Ownership of calendars lives on
// resources.provider_id; see utils/access.js for who may manage what.
// ---------------------------------------------------------------------------

import * as providerRepo from '../repositories/provider.repository.js';
import * as resourceRepo from '../repositories/resource.repository.js';
import { NotFoundError, ForbiddenError } from '../errors/app-error.js';
import { toResourceDTO } from './resource.service.js';
import { toBookingDTO } from './booking.service.js';

export function toProviderDTO(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    headline: row.headline,
    ...(row.calendar_count !== undefined && { calendarCount: row.calendar_count }),
    createdAt: row.created_at,
  };
}

/** "Dr. Amélie Lee & Co." → "dr-amelie-lee-co" (3–40 chars, a–z, 0–9, hyphens). */
export function slugify(text) {
  let s = String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  if (!s) s = 'provider';
  if (s.length < 3) s = `${s}-page`;
  return s;
}

/** The first free address based on `base`: base, base-2, base-3… */
async function firstFreeSlug(base, session) {
  if (!(await providerRepo.slugExists(base, session))) return base;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, 40 - suffix.length).replace(/-+$/g, '')}${suffix}`;
    if (!(await providerRepo.slugExists(candidate, session))) return candidate;
  }
  return `${base.slice(0, 31)}-${Date.now().toString(36)}`;
}

/**
 * Create the profile for a new provider account (inside the sign-up
 * transaction). A chosen address must be free; otherwise we derive one from
 * the name and never fail on it.
 */
export async function createProfile({ userId, displayName, slug, headline }, session) {
  const finalSlug = slug ?? (await firstFreeSlug(slugify(displayName), session));
  const row = await providerRepo.insertProvider(
    { userId, slug: finalSlug, displayName, headline },
    session,
  );
  return toProviderDTO(row);
}

export async function getProfileForUser(userId) {
  return toProviderDTO(await providerRepo.findByUserId(userId));
}

async function requireOwnProfile(user) {
  const row = await providerRepo.findByUserId(user.id);
  if (!row) throw new ForbiddenError('This account has no provider page');
  return row;
}

// --- public ---

export async function listDirectory({ q, limit }) {
  const rows = await providerRepo.listDirectory({ q, limit });
  return rows.map(toProviderDTO);
}

/** A provider's public page: profile + calendars that are taking bookings. */
export async function getPublicPage(slug) {
  const row = await providerRepo.findBySlug(slug);
  if (!row) throw new NotFoundError(`No provider at /p/${slug}`);
  const { rows } = await resourceRepo.listResources({
    limit: 100,
    offset: 0,
    activeOnly: true,
    providerId: row.id,
  });
  return { ...toProviderDTO(row), calendars: rows.map(toResourceDTO) };
}

// --- the provider's own ---

/** Profile + every calendar, including paused ones. */
export async function getMine(user) {
  const row = await requireOwnProfile(user);
  const { rows } = await resourceRepo.listResources({
    limit: 100,
    offset: 0,
    activeOnly: false,
    providerId: row.id,
  });
  return { ...toProviderDTO(row), calendars: rows.map(toResourceDTO) };
}

export async function updateMine(user, patch) {
  const row = await requireOwnProfile(user);
  return toProviderDTO(await providerRepo.updateProvider(row.id, patch));
}

/** Bookings across all of this provider's calendars, soonest first. */
export async function listMyBookings(user, { from, to, status, limit }) {
  const row = await requireOwnProfile(user);
  const rows = await providerRepo.listBookingsForProvider({
    providerId: row.id,
    from,
    to,
    status,
    limit,
  });
  return rows.map((r) => ({ ...toBookingDTO(r), userEmail: r.user_email }));
}
