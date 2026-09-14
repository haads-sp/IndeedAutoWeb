import 'server-only';

/**
 * Signup.
 *
 * The single most important property of this module is that **its result does not reveal
 * whether an account already exists for the given address.** BUILD-PLAN.md Stage 3 calls
 * an enumeration oracle here "the most common real vulnerability in this flow", and it is
 * right: an attacker with a list of addresses should not be able to learn which of your
 * customers are customers.
 *
 * Two things protect that property, and both matter:
 *
 * 1. Supabase already obfuscates its own response when email confirmation is enabled — a
 *    signup for an existing confirmed address returns a user object with an empty
 *    `identities` array rather than an error. **We never inspect `identities`**, because
 *    branching on it is precisely how the oracle gets reintroduced by someone being
 *    helpful.
 * 2. Should Supabase nevertheless return an "already registered" error — it does when
 *    email confirmation is switched off — we map it to the SAME success outcome as a
 *    genuine new signup. If that setting is ever toggled, this flow stays closed.
 *
 * The user-visible consequence is deliberate: after signing up, everyone is told to check
 * their email, including someone who already has an account. The person who really does
 * own that address learns the truth from their inbox, where the attacker is not.
 */

import { createClient } from '@/lib/supabase/server';
import { absoluteUrl } from '@/lib/env/site-url';

import { passwordRejectionMessage, validatePassword, validatePasswordShape } from './password';
import { checkRateLimit } from './rate-limit';

export type SignupOutcome =
  /** Returned whether or not the address was already registered. See above. */
  | { outcome: 'verification_sent' }
  | { outcome: 'password_rejected'; message: string }
  | { outcome: 'invalid_email' }
  /** OUR limit only — keyed on the typed address, account or not. Never Supabase's. */
  | { outcome: 'rate_limited'; retryAfterSeconds: number }
  | { outcome: 'unavailable' };

/** Where the link in the email lands. The route that consumes it is src/app/auth/confirm. */
const CONFIRM_PATH = '/auth/confirm';

/** Deliberately permissive. The address is proven by the email arriving, not by a regex. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export async function signUp(
  email: string,
  password: string,
  ip: string | null,
): Promise<SignupOutcome> {
  const trimmed = email.trim().toLowerCase();

  if (!looksLikeEmail(trimmed)) {
    return { outcome: 'invalid_email' };
  }

  // The cheap, local length check runs BEFORE the limiter, so someone correcting a
  // too-short password does not spend their attempts on a typo.
  const shape = validatePasswordShape(password);
  if (!shape.ok) {
    return { outcome: 'password_rejected', message: passwordRejectionMessage(shape.rejection) };
  }

  // Then the limiter, BEFORE anything that leaves this process: the breach lookup and
  // Supabase. Every allowed signup for a new address sends a real email to a real inbox.
  // Keyed on the address as typed, so it behaves identically for registered and
  // unregistered addresses and cannot itself become an oracle.
  const decision = await checkRateLimit('signup', trimmed, ip);
  if (!decision.allowed) {
    return { outcome: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds };
  }

  // Password is validated BEFORE calling Supabase, so a rejected password costs no
  // account-creation attempt and cannot be used to probe for existing addresses.
  const passwordCheck = await validatePassword(password);
  if (!passwordCheck.ok) {
    return {
      outcome: 'password_rejected',
      message: passwordRejectionMessage(passwordCheck.rejection),
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: trimmed,
    password,
    options: {
      emailRedirectTo: absoluteUrl(CONFIRM_PATH),
    },
  });

  if (!error) {
    // NOTE: `data.user.identities` is intentionally not examined. See the module comment.
    return { outcome: 'verification_sent' };
  }

  // docs/ISSUES.md row 6. Supabase's 429 is NOT surfaced as rate_limited. Supabase applies
  // a per-address cooldown before sending another confirmation email, but it sends nothing
  // for an address that already has a confirmed account — so that account never hits the
  // cooldown. Observed on preview: a second quick signup returned 200 for an existing
  // confirmed address and 429 over_email_send_rate_limit for a fresh one. Mapping 429 to
  // "too many attempts" turned that into a visible difference: an enumeration oracle.
  // It gets the identical success outcome instead. Our own limit, above, is what tells a
  // real user to slow down.
  if (error.status === 429) {
    return { outcome: 'verification_sent' };
  }

  // Supabase surfaces this only when email confirmation is disabled. Mapping it to the
  // success outcome keeps the flow enumeration-safe even if that setting changes.
  if (/already registered|already been registered|user already exists/i.test(error.message)) {
    return { outcome: 'verification_sent' };
  }

  if (/password/i.test(error.message)) {
    // Supabase applies its own minimum on top of ours; if the two ever disagree, the
    // user still gets an actionable message rather than a generic failure.
    return {
      outcome: 'password_rejected',
      message: passwordRejectionMessage({ reason: 'too_short', minimum: 12 }),
    };
  }

  if (/email|address/i.test(error.message)) {
    return { outcome: 'invalid_email' };
  }

  // Anything else is ours, not the user's. The detail goes to Sentry from Stage 10;
  // the user gets nothing internal (prohibition P3).
  return { outcome: 'unavailable' };
}
