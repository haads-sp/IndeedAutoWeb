import 'server-only';

/**
 * Login.
 *
 * Two properties matter here beyond "does the password match":
 *
 * 1. **A wrong password and a non-existent account are indistinguishable.** Both return
 *    `invalid_credentials`. Anything else turns the login form into the same enumeration
 *    oracle the signup flow was carefully built to avoid.
 * 2. **A session is not verification** (prohibition P4). Supabase refuses to issue a
 *    session for an unconfirmed address while email confirmation is on, so this is
 *    enforced upstream of us — but we surface it as its own outcome rather than letting
 *    it fall into "invalid credentials", because the user needs different advice.
 */

import { createClient } from '@/lib/supabase/server';

import { checkLoginRateLimit } from './rate-limit';

export type LoginOutcome =
  | { outcome: 'signed_in' }
  | { outcome: 'invalid_credentials' }
  | { outcome: 'email_not_confirmed' }
  | { outcome: 'rate_limited'; retryAfterSeconds: number }
  | { outcome: 'missing_fields' }
  | { outcome: 'unavailable' };

export async function logIn(
  email: string,
  password: string,
  ip: string | null,
): Promise<LoginOutcome> {
  const trimmed = email.trim().toLowerCase();

  if (!trimmed || !password) {
    return { outcome: 'missing_fields' };
  }

  // Rate limit BEFORE touching Supabase, so a limited attempt costs no auth call and
  // cannot be used to time whether an account exists.
  const decision = await checkLoginRateLimit(trimmed, ip);
  if (!decision.allowed) {
    return { outcome: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: trimmed, password });

  if (!error) {
    return { outcome: 'signed_in' };
  }

  // Supabase returns this only when the password was CORRECT but the address is
  // unconfirmed. It is safe to distinguish: reaching it already requires knowing the
  // password, so it reveals nothing an attacker did not have.
  if (/email not confirmed|not confirmed/i.test(error.message)) {
    return { outcome: 'email_not_confirmed' };
  }

  if (error.status === 429) {
    // Supabase's own limiter, behind ours. Reported as rate limited rather than as a
    // failure, so the user is told to wait instead of doubting their password.
    return { outcome: 'rate_limited', retryAfterSeconds: 60 };
  }

  if (/invalid login credentials|invalid credentials/i.test(error.message)) {
    return { outcome: 'invalid_credentials' };
  }

  return { outcome: 'unavailable' };
}

/**
 * Sign out.
 *
 * `scope: 'local'` clears this browser's session only. Signing out of one device must not
 * sign you out everywhere — that behaviour belongs to a password reset (Stage 7), where
 * killing every session is the point.
 */
export async function logOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });
}
