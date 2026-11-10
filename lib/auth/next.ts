/** Where to come back to after signing in with Buffer: kept for 10 minutes. */
export const NEXT_COOKIE = "ferry_next";

const MAX_NEXT = 4096;
/** Browsers drop a cookie over about 4 KB, and the value is stored encoded. */
const MAX_ENCODED = 3500;
const PLACEHOLDER = "https://ferry.invalid";

/**
 * The page to return to after sign-in, or null. Only the consent screen
 * qualifies: it's the one page that sends people to Buffer and needs
 * them back, and a narrow rule can't become an open redirect.
 */
export function safeNext(value: string | null | undefined): string | null {
  if (!value || value.length > MAX_NEXT) return null;
  if (!/^\/oauth\/authorize(?:\?|$)/.test(value)) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, PLACEHOLDER);
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER || url.pathname !== "/oauth/authorize")
    return null;
  const next = `${url.pathname}${url.search}`;
  return encodeURIComponent(next).length <= MAX_ENCODED ? next : null;
}
