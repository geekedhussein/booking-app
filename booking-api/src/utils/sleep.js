// ---------------------------------------------------------------------------
// SLEEP / TIMEOUT HELPERS  (V2.12)
//
// `new Promise(r => setTimeout(r, ms))` is the usual one-liner, but the arrow
// implicitly RETURNS the timer handle from the promise executor — a value that
// can never be read, and a lint error (no-promise-executor-return). Using a block
// body fixes it. Centralising these also stops the pattern being re-copied.
// ---------------------------------------------------------------------------

/** Resolve after `ms` milliseconds. */
export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Reject after `ms` milliseconds — pair with Promise.race for a timeout. */
export function timeoutAfter(ms, message = 'timeout') {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}
