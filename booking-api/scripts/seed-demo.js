// ---------------------------------------------------------------------------
// DEMO DATA  (not part of the app)
//
// Fills an EMPTY database with demo providers, calendars, opening hours and
// bookings, by calling the same services the API uses (so every rule and
// guarantee applies). Run after migrating:
//
//   npm run migrate && npm run seed
//
// Accounts (password for all: password123):
//   clients    sam@example.com, casey@example.com
//   providers  courts@example.com, yoga@example.com, hub@example.com, lee@example.com
//   staff      staff@example.com
// ---------------------------------------------------------------------------

import { col, closeDb } from '../src/db/index.js';
import * as authService from '../src/services/auth.service.js';
import * as resourceService from '../src/services/resource.service.js';
import * as availabilityService from '../src/services/availability.service.js';
import * as bookingService from '../src/services/booking.service.js';
import { closeQueue } from '../src/queue/notifications.js';
import { closePubSub } from '../src/realtime/pubsub.js';
import { closeCache } from '../src/cache/index.js';

const PASSWORD = 'password123';
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

async function main() {
  if ((await col('users').countDocuments()) > 0) {
    console.log('The database already has users; seed only runs on an empty database.');
    return;
  }

  const client = async (email) =>
    (await authService.register({ email, password: PASSWORD })).user;
  const provider = async (email, displayName, headline, slug) =>
    (
      await authService.register({
        email,
        password: PASSWORD,
        accountType: 'provider',
        displayName,
        headline,
        slug,
      })
    ).user;

  const sam = await client('sam@example.com');
  const casey = await client('casey@example.com');
  const staff = await client('staff@example.com');
  await col('users').updateOne({ email: 'staff@example.com' }, { $set: { role: 'staff' } });
  const courts = await provider(
    'courts@example.com',
    'Riverside Tennis Club',
    'Indoor and outdoor courts, coaching on request',
    'riverside-tennis',
  );
  const yoga = await provider(
    'yoga@example.com',
    'Studio A Yoga',
    'Small-group vinyasa and restorative classes',
    'studio-a-yoga',
  );
  const hub = await provider(
    'hub@example.com',
    'Hub Coworking',
    'Meeting rooms by the hour',
    'hub-coworking',
  );
  const lee = await provider(
    'lee@example.com',
    'Dr Amélie Lee',
    'Sports physiotherapy and rehab',
    'dr-amelie-lee',
  );
  await col('users').updateMany(
    {
      email: {
        $in: [
          'staff@example.com',
          'casey@example.com',
          'courts@example.com',
          'lee@example.com',
        ],
      },
    },
    { $set: { email_verified: true } },
  );

  const as = (u) => ({ id: u.id, role: u.role });
  const centre = await resourceService.createResource(
    {
      name: 'Centre Court',
      capacity: 1,
      minDurationMinutes: 30,
      maxDurationMinutes: 120,
      leadTimeMinutes: 60,
      bufferMinutes: 15,
    },
    as(courts),
  );
  const flow = await resourceService.createResource(
    { name: 'Morning flow', capacity: 4, minDurationMinutes: 60, maxDurationMinutes: 60 },
    as(yoga),
  );
  const room = await resourceService.createResource(
    { name: 'Meeting Room 2', capacity: 1, maxDurationMinutes: 240 },
    as(hub),
  );
  const practice = await resourceService.createResource(
    {
      name: 'Practice Court 3',
      capacity: 2,
      minDurationMinutes: 30,
      maxDurationMinutes: 90,
      bufferMinutes: 10,
    },
    as(courts),
  );
  const consult = await resourceService.createResource(
    {
      name: 'Consultation',
      capacity: 1,
      minDurationMinutes: 30,
      maxDurationMinutes: 60,
      leadTimeMinutes: 120,
      bufferMinutes: 15,
    },
    as(lee),
  );

  const every = (days, opensAt, closesAt) =>
    days.map((dayOfWeek) => ({ dayOfWeek, opensAt, closesAt }));
  const all = [0, 1, 2, 3, 4, 5, 6];
  await availabilityService.setAvailability(
    centre.id,
    every(all, '07:00', '21:00'),
    as(courts),
  );
  await availabilityService.setAvailability(
    practice.id,
    every(all, '07:00', '21:00'),
    as(courts),
  );
  await availabilityService.setAvailability(
    flow.id,
    [...every([1, 2, 3, 4, 5], '08:00', '12:00'), ...every([1, 2, 3, 4, 5], '13:00', '19:00')],
    as(yoga),
  );
  await availabilityService.setAvailability(
    consult.id,
    every([1, 2, 3, 4, 5, 6], '09:00', '18:00'),
    as(lee),
  );

  const book = (user, cal, date, from, to) =>
    bookingService
      .createBooking({
        resourceId: cal.id,
        userId: user.id,
        startsAt: `${date} ${from}:00`,
        endsAt: `${date} ${to}:00`,
      })
      .catch((err) => console.log(`  skipped ${cal.name} ${date} ${from}: ${err.message}`));

  const [d0, d1, d2] = [day(0), day(1), day(2)];
  await book(sam, centre, d0, '15:00', '16:30');
  await book(casey, centre, d0, '18:00', '20:00');
  await book(sam, flow, d0, '13:00', '14:00');
  await book(casey, flow, d0, '13:00', '14:00');
  await book(sam, flow, d0, '16:00', '17:00');
  await book(casey, practice, d0, '17:00', '18:00');
  await book(sam, practice, d0, '17:00', '18:00');
  await book(sam, room, d0, '14:00', '17:00');
  await book(casey, consult, d1, '10:00', '11:00');
  await book(sam, consult, d1, '14:00', '14:30');
  await book(casey, centre, d1, '09:00', '10:30');
  await book(sam, centre, d1, '12:00', '13:00');
  await book(casey, centre, d1, '17:00', '19:00');
  await book(sam, practice, d1, '10:00', '11:00');
  await book(casey, practice, d1, '10:00', '11:00');
  await book(sam, practice, d1, '15:00', '16:00');
  await book(casey, room, d2, '14:00', '16:00');
  await book(casey, centre, d2, '08:00', '09:00');

  console.log(
    `Seeded: ${await col('users').countDocuments()} users, ${await col('resources').countDocuments()} calendars, ${await col('bookings').countDocuments()} bookings.`,
  );
  console.log(`staff id ${staff.id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => Promise.allSettled([closeQueue(), closePubSub(), closeCache(), closeDb()]));
