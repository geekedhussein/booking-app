// ---------------------------------------------------------------------------
// WEBHOOK SIGNING  (V2.10 → Part XI webhooks; Part IX signature verification)
//
// A webhook endpoint is a public URL, so the receiver needs proof the request
// really came from us. We HMAC the payload with a per-subscription shared secret
// and send it as a header; the receiver recomputes and compares.
//
// Two details that matter:
//   • The signed material includes a TIMESTAMP, so an attacker can't capture a
//     valid request and replay it forever (receivers should reject old ones).
//   • Comparison must be TIMING-SAFE — a plain === leaks, byte by byte, how much
//     of the signature was correct (Part IV timing side-channels).
// ---------------------------------------------------------------------------

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export function generateWebhookSecret() {
  return `whsec_${randomBytes(24).toString('hex')}`;
}

/** Sign `${timestamp}.${body}` — the timestamp is part of the signed material. */
export function signPayload({ secret, timestamp, body }) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** Timing-safe comparison of two hex signatures. */
export function verifySignature({ secret, timestamp, body, signature }) {
  const expected = signPayload({ secret, timestamp, body });
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature ?? ''), 'utf8');
  if (a.length !== b.length) return false; // length mismatch → definitely invalid
  return timingSafeEqual(a, b);
}

// Header names follow the common convention (Stripe-style).
export const SIGNATURE_HEADER = 'x-webhook-signature';
export const TIMESTAMP_HEADER = 'x-webhook-timestamp';
