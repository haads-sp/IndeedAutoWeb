import 'server-only';

/**
 * Who is asking, and are they verified.
 *
 * **Prohibition P4: never treat "has a session" as "is verified".** Those are two separate
 * questions with two separate sources, and this module is the only place that answers
 * either of them.
 *
 * - *Is there a valid session, and whose?* — `getClaims()`. Fast, signature-verified
 *   locally against a cached JWKS (both projects use ES256; see docs/DOMAIN.md).
 * - *Is the address verified?* — `getUser()`, which revalidates against the Auth server
 *   and returns `email_confirmed_at`.
 *
 * **It is NOT read from `user_metadata.email_verified`**, which is present, looks right,
 * and is writable by the user via `updateUser({ data })`. Supabase signs whatever is in
 * there. A valid signature proves the token is authentic, not that its contents are true.
 * See docs/DOMAIN.md.
 */

import { createClient } from '@/lib/supabase/server';

export type SessionState =
  | { state: 'anonymous' }
  | { state: 'unverified'; userId: string; email: string | null }
  | { state: 'verified'; userId: string; email: string | null };

export async function currentSession(): Promise<SessionState> {
  const supabase = await createClient();

  // Cheap check first: no valid session means no network call to the Auth server.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (!claims?.sub) {
    return { state: 'anonymous' };
  }

  // There IS a session. Whether the address is confirmed is a different question, and the
  // only trustworthy answer comes from auth.users.
  const { data: userData, error } = await supabase.auth.getUser();
  const user = userData?.user;

  if (error || !user) {
    // A signature-valid token whose user cannot be fetched — revoked, deleted, or the
    // Auth server is unreachable. Fail closed: treat as anonymous rather than assuming.
    return { state: 'anonymous' };
  }

  const email = user.email ?? null;

  if (!user.email_confirmed_at) {
    return { state: 'unverified', userId: user.id, email };
  }

  return { state: 'verified', userId: user.id, email };
}
