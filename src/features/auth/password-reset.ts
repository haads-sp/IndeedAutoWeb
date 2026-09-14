import 'server-only';

/**
 * Password reset.
 *
 * BUILD-PLAN.md Stage 7:
 *   - Identical response for known and unknown addresses.
 *   - Single-use, time-limited token.
 *   - Invalidate all existing sessions on a successful reset.
 *   - Rate limited.
 *
 * The token is Supabase's: `verifyOtp` consumes a recovery `token_hash` once, and it
 * expires on the project's OTP expiry. Everything else is enforced here.
 */

import { absoluteUrl } from '@/lib/env/site-url';
import { createClient } from '@/lib/supabase/server';

import { passwordRejectionMessage, validatePassword } from './password';
import { checkRateLimit } from './rate-limit';

// ---------------------------------------------------------------------------
// Requesting a reset
// ---------------------------------------------------------------------------

export type ResetRequestOutcome =
  /** Returned whether or not an account exists for the address. */
  | { outcome: 'reset_requested' }
  | { outcome: 'invalid_email' }
  | { outcome: 'rate_limited'; retryAfterSeconds: number };

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

/**
 * **Every response from Supabase — success, error, or rate limit — maps to the same
 * outcome.** Only our own format check and our own limiter produce anything different,
 * and neither depends on whether an account exists.
 *
 * The subtle case is Supabase's 429. Supabase throttles repeat recovery emails per
 * address, but it only sends email for addresses that have an account. So a second quick
 * request for a REAL address can come back 429 while the same request for an unknown
 * address comes back 200 — and passing that through would be an oracle for exactly the
 * information this flow must not reveal. Our Upstash limit is safe to surface because it
 * keys on the address as typed, account or not.
 */
export async function requestPasswordReset(
  email: string,
  ip: string | null,
): Promise<ResetRequestOutcome> {
  const normalised = email.trim().toLowerCase();

  if (!looksLikeEmail(normalised)) {
    return { outcome: 'invalid_email' };
  }

  const decision = await checkRateLimit('passwordReset', normalised, ip);
  if (!decision.allowed) {
    return { outcome: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds };
  }

  try {
    const supabase = await createClient();

    // The result is deliberately discarded. See the doc comment.
    await supabase.auth.resetPasswordForEmail(normalised, {
      redirectTo: absoluteUrl('/auth/confirm'),
    });
  } catch {
    // A thrown network failure lands here rather than crashing to an error page (P3). It
    // too returns the identical outcome: an outage is not account-dependent, and the page
    // already tells the user to request another link if nothing arrives.
  }

  return { outcome: 'reset_requested' };
}

// ---------------------------------------------------------------------------
// Completing a reset
// ---------------------------------------------------------------------------

/**
 * How recently the user must have proven control of their inbox to set a new password.
 *
 * Without this, ANY signed-in session could set a new password with no knowledge of the
 * current one — so anyone who found an unlocked, signed-in computer could take the account
 * and lock its owner out. Requiring a fresh one-time-code sign-in means the reset form is
 * only usable by whoever just clicked the link in the inbox.
 */
export const RECOVERY_WINDOW_SECONDS = 15 * 60;

/**
 * The authentication methods that prove inbox control. A recovery link verified through
 * `verifyOtp` is recorded as a one-time-code sign-in; `recovery` and `magiclink` are
 * accepted as well because they prove the same thing, and the exact label for this flow
 * is not pinned by the library's types.
 *
 * `password` is deliberately absent. Knowing the password is exactly what a reset exists
 * for people who do not.
 */
const INBOX_PROOF_METHODS = new Set(['otp', 'recovery', 'magiclink']);

type AmrEntry = { method: string; timestamp: number };

/**
 * True when the token records an inbox-proving sign-in within the recovery window.
 *
 * Pure, so it can be tested without a network. `amr` is set by the Auth server when the
 * token is minted and is not writable by the user (unlike `user_metadata`; see
 * docs/DOMAIN.md), and the JWT carrying it has already had its signature verified.
 */
export function isFreshRecovery(amr: unknown, nowSeconds: number): boolean {
  if (!Array.isArray(amr)) return false;

  return amr.some((entry): entry is AmrEntry => {
    // The bare string[] form carries no timestamp, so recency cannot be established.
    // Fail closed.
    if (typeof entry !== 'object' || entry === null) return false;

    const { method, timestamp } = entry as Partial<AmrEntry>;
    if (typeof method !== 'string' || typeof timestamp !== 'number') return false;
    if (!INBOX_PROOF_METHODS.has(method)) return false;

    const age = nowSeconds - timestamp;
    // A timestamp in the future is not "fresh", it is wrong.
    return age >= 0 && age <= RECOVERY_WINDOW_SECONDS;
  });
}

/**
 * isFreshRecovery against the current time.
 *
 * Exists so callers never read the clock themselves — a component that calls Date.now()
 * during render is impure (react-hooks/purity), and the pure function above stays testable
 * with a fixed time.
 */
export function hasFreshRecovery(amr: unknown): boolean {
  return isFreshRecovery(amr, Math.floor(Date.now() / 1000));
}

export type ResetCompletionOutcome =
  | { outcome: 'password_updated' }
  /** The password changed, but signing out every session did not complete. */
  | { outcome: 'password_updated_sessions_uncertain' }
  | { outcome: 'no_recovery_session' }
  | { outcome: 'password_rejected'; message: string }
  | { outcome: 'unavailable' };

export async function completePasswordReset(newPassword: string): Promise<ResetCompletionOutcome> {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (!claims?.sub || !hasFreshRecovery(claims.amr)) {
    return { outcome: 'no_recovery_session' };
  }

  const check = await validatePassword(newPassword);
  if (!check.ok) {
    return { outcome: 'password_rejected', message: passwordRejectionMessage(check.rejection) };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });

  if (error) {
    if (/different from the old password|same password|should be different/i.test(error.message)) {
      return {
        outcome: 'password_rejected',
        message: 'Choose a password you have not used on this account before.',
      };
    }
    if (/password/i.test(error.message)) {
      return {
        outcome: 'password_rejected',
        message: passwordRejectionMessage({ reason: 'too_short', minimum: 12 }),
      };
    }
    return { outcome: 'unavailable' };
  }

  // "Invalidate all existing sessions on a successful reset." GLOBAL, so this device is
  // signed out too and the new password is proven by signing in with it.
  //
  // This revokes the sessions; it does not expire access tokens already issued. That gap
  // is closed in the database: every policy requires public.session_is_active(), so a
  // revoked session's still-unexpired JWT reads nothing. See the migration
  // 20260914043017_session_revocation.sql.
  const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' });

  if (signOutError) {
    // Not reported as plain success. Telling the user every other device is signed out
    // when that did not happen would be a false claim about their security (P7).
    return { outcome: 'password_updated_sessions_uncertain' };
  }

  return { outcome: 'password_updated' };
}
