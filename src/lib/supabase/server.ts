/**
 * Server Supabase client, bound to the request's cookies.
 *
 * Still the PUBLISHABLE key, not the secret one. Server-side code running as the user
 * should be subject to that user's RLS policies — that is the whole point of the policies.
 * The secret key carries `BYPASSRLS` and belongs only in the few places that genuinely
 * need to act as no one, which Stage 2 does not have.
 *
 * `import 'server-only'` makes importing this from a `'use client'` file a build error.
 */

import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies, headers } from 'next/headers';

import { supabasePublicConfig } from './config';
import { requestIsHttps, sessionCookieOptions } from './cookie-options';

/**
 * Creates a request-scoped server client.
 *
 * Must be called per request — never hoisted to a module-level constant — because it
 * closes over that request's cookie store.
 */
export async function createClient() {
  const { url, publishableKey } = supabasePublicConfig();
  const cookieStore = await cookies();
  const isHttps = requestIsHttps(await headers());

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            // Flags forced here, not trusted from the library. See cookie-options.ts.
            cookieStore.set(name, value, sessionCookieOptions(options, isHttps));
          }
        } catch {
          // Server Components cannot set cookies. This is expected and safe to ignore
          // HERE, but only because something else refreshes the session: from Stage 4
          // that is proxy.ts, which runs before the render and can write. Until then,
          // a token refreshed during a Server Component render is simply not persisted.
        }
      },
    },
  });
}

/**
 * The authenticated user's claims, or null.
 *
 * **Use this for access decisions, never `getSession()`.** `getSession()` reads the
 * cookie and returns whatever is in it without revalidating, so it will happily report a
 * session for a forged or expired token. `getClaims()` verifies the JWT signature against
 * the project's published keys.
 *
 * See docs/DOMAIN.md for the one caveat: local verification via cached JWKS happens only
 * when the project uses asymmetric signing keys. The rule holds either way.
 */
export async function getClaims() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data) return null;
  return data.claims;
}
