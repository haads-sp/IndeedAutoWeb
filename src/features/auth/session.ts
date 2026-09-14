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
  /**
   * A soft-deleted account. Supabase still lets it sign in — a soft delete touches only
   * profiles.deleted_at, never auth.users — so the application has to refuse it.
   */
  | { state: 'deleted'; userId: string; email: string | null }
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

  // BUILD-PLAN.md Stage 8: "access revoked immediately". Deletion signs out every session,
  // but that is not the only guarantee — if the sign-out failed, or a session somehow
  // survived, the account must still be refused here. Read through a SECURITY DEFINER
  // function because RLS hides a deleted user's own profile row from them.
  const { data: active, error: activeError } = await supabase.rpc('account_is_active');

  if (activeError) {
    // Could not establish whether the account is active. Fail closed — but as anonymous,
    // NOT as deleted: a transient error must never tell someone their account is gone.
    return { state: 'anonymous' };
  }

  if (active !== true) {
    return { state: 'deleted', userId: user.id, email };
  }

  return { state: 'verified', userId: user.id, email };
}
