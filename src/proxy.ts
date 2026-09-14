/**
 * Session refresh.
 *
 * **This file is `proxy.ts`, not `middleware.ts`.** Next 16 deprecated the `middleware`
 * convention and renamed it to `proxy`, with the export renamed to match. See
 * docs/DOMAIN.md. Proxy runs on the Node.js runtime only — setting a `runtime` config
 * option here throws.
 *
 * What it does: Supabase access tokens are short-lived. Without something refreshing them
 * ahead of the render, a user who leaves a tab open comes back to an expired token and is
 * silently signed out. A Server Component cannot fix that itself, because it cannot write
 * cookies. The proxy runs before the render and can, so this is the only place the refresh
 * can happen.
 *
 * It deliberately does NOT make access decisions. A redirect here is not a security
 * boundary (prohibition P2), and route protection is Stage 5. This refreshes a token and
 * nothing else.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { CORRELATION_HEADER } from '@/lib/request/correlation-header';
import { supabasePublicConfig } from '@/lib/supabase/config';
import { requestIsHttps, sessionCookieOptions } from '@/lib/supabase/cookie-options';

export async function proxy(request: NextRequest) {
  // HTTPS everywhere except local development. Vercel terminates TLS and sets
  // x-forwarded-proto; Cloudflare is not in the path (BUILD-PLAN.md §4.4).
  const isHttps = requestIsHttps(request.headers) || request.nextUrl.protocol === 'https:';

  // One correlation id per request (BUILD-PLAN.md Stage 9), generated HERE and always
  // OVERWRITING any value the client sent. A client-chosen id would let a request pose as
  // part of someone else's trail in the logs. Set on the request before either
  // NextResponse.next({ request }) below, so it reaches Server Components and Server Actions
  // through both the ordinary path and the cookie-refresh path.
  const correlationId = crypto.randomUUID();
  request.headers.set(CORRELATION_HEADER, correlationId);

  let response = NextResponse.next({ request });

  const { url, publishableKey } = supabasePublicConfig();

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Write to the REQUEST first so anything rendering downstream in this same pass
        // sees the refreshed token rather than the stale one it arrived with.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, sessionCookieOptions(options, isHttps));
        }
      },
    },
  });

  // This call is the entire point of the file. getClaims() validates the JWT and, when it
  // is close to expiry, triggers the refresh that calls setAll above.
  //
  // getClaims(), never getSession() — BUILD-PLAN.md §4.3. Both projects publish ES256 keys
  // (docs/DOMAIN.md), so this verifies locally against a cached JWKS with no network hop.
  await supabase.auth.getClaims();

  // Echoed on the response, so a person reporting a problem can quote the id and it can be
  // matched to the server's log lines for that exact request.
  response.headers.set(CORRELATION_HEADER, correlationId);

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *  - _next/static, _next/image  — build output, no session to refresh
     *  - favicon and common image extensions
     *  - /api/version               — a liveness probe must not depend on auth working
     *
     * Without a matcher, proxy runs on every request including static assets, which turns
     * one token refresh per navigation into dozens.
     */
    '/((?!_next/static|_next/image|api/version|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
