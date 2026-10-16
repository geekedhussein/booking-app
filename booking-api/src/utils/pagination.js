// ---------------------------------------------------------------------------
// PAGINATION HELPER  (Phase 1 → Part V: CRUD done properly)
//
// Never return an entire table (Part V). We parse ?page & ?limit from the query
// string into a safe { page, limit, offset }, applying defaults and a hard cap
// so a client can't request a million rows in one call. This is offset/limit
// pagination — simple and perfect for admin-style lists. For very large,
// fast-changing datasets you'd switch to CURSOR pagination (Part V); this API is
// small enough that offset/limit is the right, honest choice.
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function parsePagination(query = {}) {
  let page = Number.parseInt(query.page, 10);
  let limit = Number.parseInt(query.limit, 10);

  if (!Number.isInteger(page) || page < 1) page = 1;
  if (!Number.isInteger(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT; // cap — protect the DB (Part IX)

  const offset = (page - 1) * limit;
  return { page, limit, offset };
}
