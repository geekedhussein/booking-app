// ---------------------------------------------------------------------------
// CURSOR PAGINATION  (V2.10 → Part V: pagination done properly)
//
// Offset pagination degrades: skipping 10,000 items makes the DB walk and discard
// them, and concurrent inserts shift items so clients see duplicates or skips.
//
// A cursor encodes "where you left off" — the last item's sort key plus its id as
// a tiebreaker. The query becomes a keyset lookup, "everything before
// (cursorStartsAt, cursorId)", which in MongoDB is
//     { $or: [{ starts_at: { $lt: k } }, { starts_at: k, _id: { $lt: i } }] }
// It uses the index directly (no skipping) and is stable under concurrent
// inserts. Tradeoff: no random access to "page 47" — you page forward only.
//
// The cursor is base64url of a JSON payload. It's OPAQUE by contract: clients
// must treat it as a blob and pass it back verbatim, which lets us change the
// encoding later without breaking them. (Not encrypted — don't put secrets in it.)
// ---------------------------------------------------------------------------

export function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor) {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.k || !parsed.i) return null;
    return parsed; // { k: sortKeyValue, i: id }
  } catch {
    return null; // malformed → caller treats as "start from the beginning"
  }
}
