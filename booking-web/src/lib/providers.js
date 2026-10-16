// ---------------------------------------------------------------------------
// PROVIDER HELPERS (V3) — page addresses and links.
// Mirrors the backend's slugify so the sign-up form can preview the address
// it will most likely get. The server stays authoritative (it adds -2, -3… when
// a derived address is taken, and rejects a chosen one that is).
// ---------------------------------------------------------------------------

export function slugify(text) {
  let s = String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  if (!s) return '';
  if (s.length < 3) s = `${s}-page`;
  return s;
}

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The path of a provider's public page. */
export const providerPath = (slug) => `/p/${slug}`;

/** The full, shareable link (uses wherever this app is being served). */
export const providerUrl = (slug) => `${window.location.origin}${providerPath(slug)}`;

/** "reserve.example.com/p/" — the visible prefix in the address field. */
export const pagePrefix = () => `${window.location.host}/p/`;
