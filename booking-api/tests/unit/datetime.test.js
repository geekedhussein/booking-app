// ---------------------------------------------------------------------------
// UNIT TEST — pure function  (Phase 1 → Part XI: unit tests)
//
// The simplest tier of the pyramid: a pure function, no dependencies, no
// mocking. Fast, deterministic, and it pins down exactly the tricky edge cases
// (rejecting impossible dates, canonicalizing format) that are easy to break.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalDateTime, isBefore } from '../../src/utils/datetime.js';

test('parseLocalDateTime canonicalizes valid inputs', () => {
  assert.equal(parseLocalDateTime('2026-09-10 09:00'), '2026-09-10 09:00:00');
  assert.equal(parseLocalDateTime('2026-09-10T09:30:15'), '2026-09-10 09:30:15');
});

test('parseLocalDateTime rejects impossible dates', () => {
  assert.equal(parseLocalDateTime('2026-02-30 09:00'), null); // Feb 30
  assert.equal(parseLocalDateTime('2026-13-01 09:00'), null); // month 13
  assert.equal(parseLocalDateTime('2026-09-10 25:00'), null); // hour 25
  assert.equal(parseLocalDateTime('garbage'), null);
});

test('isBefore compares wall-clock instants', () => {
  assert.equal(isBefore('2026-09-10 09:00:00', '2026-09-10 10:00:00'), true);
  assert.equal(isBefore('2026-09-10 10:00:00', '2026-09-10 09:00:00'), false);
  assert.equal(isBefore('2026-09-10 09:00:00', '2026-09-10 09:00:00'), false);
});
