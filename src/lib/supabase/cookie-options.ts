/**
 * Cookie attributes for the session cookies.
 *
 * **This exists because there are TWO places that write session cookies** — `proxy.ts` on
 * refresh, and `server.ts` during a Server Action such as sign-in — and the first version
 * of this code set the flags in only one of them. The result passed every test and every
 * build, and produced session cookies with no `HttpOnly` and no `Secure` on the path that
 * actually creates a session. It was caught by looking at the browser, not by any check
 * we had. See docs/ISSUES.md row 2.
 *
 * So the attributes live here, once, and both call sites import them. Two copies of a
 * security control is one copy too many.
 */

import type { CookieOptions } from '@supabase/ssr';

/** The subset of cookie attributes we insist on, whatever the library suggests. */
export interface SessionCookieAttributes {
  readonly httpOnly: true;
  readonly sameSite: 'lax';
  readonly secure: boolean;
  readonly path: string;
}

/**
 * Merges the library's options with ours, ours winning.
 *
 * - **httpOnly** — the session token must be unreadable from JavaScript. Without it, any
 *   XSS anywhere on the page escalates directly to account takeover. This also means the
 *   `@supabase/ssr` BROWSER client can no longer read the session, which is intentional:
 *   authentication in this app is server-side only.
 * - **sameSite: 'lax'** — the cookie is not sent on cross-site POSTs, which is most of
 *   CSRF gone. 'strict' would break following a link back into the app from an email,
 *   which this product depends on.
 * - **secure** — never sent over plain http. Conditioned rather than hardcoded, because
 *   `true` on http://localhost means the cookie is silently dropped and local development
 *   cannot log in at all.
 * - **path: '/'** — one session for the whole app, not one per path.
 */
export function sessionCookieOptions(
  options: CookieOptions | undefined,
  isHttps: boolean,
): CookieOptions & SessionCookieAttributes {
  return {
    ...options,
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
  };
}

/**
 * Whether this request arrived over HTTPS.
 *
 * Vercel terminates TLS and sets `x-forwarded-proto`. Cloudflare is DNS-only and is not in
 * the request path (BUILD-PLAN.md §4.4), so no Cloudflare header is consulted.
 */
export function requestIsHttps(headers: Headers): boolean {
  const proto = headers.get('x-forwarded-proto');
  if (proto) return proto.split(',')[0]?.trim() === 'https';

  // No header at all means a direct connection, which locally is http. Defaulting to
  // false here is the safe direction: it costs the Secure flag in local development and
  // never removes it in production, where Vercel always sets the header.
  return false;
}
