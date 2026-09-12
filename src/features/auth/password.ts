/**
 * Password policy.
 *
 * Length and breach history only. **No composition rules** — no "must contain a digit, an
 * uppercase letter and a symbol". BUILD-PLAN.md Stage 3: "do not impose composition rules
 * that push users toward `Password1!`". Supabase's own documentation recommends the
 * opposite; the reasoning for going against it is in docs/DECISIONS.md.
 */

import { checkBreachedPassword } from './breached-password';

/** Matches the minimum set in the Supabase dashboard. Both must move together. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Upper bound. Not a strength rule — a guard. bcrypt-family hashes silently truncate past
 * 72 bytes, and accepting unbounded input invites a CPU-exhaustion attack where a
 * megabyte password is hashed on every attempt.
 */
export const MAX_PASSWORD_LENGTH = 128;

export type PasswordRejection =
  | { reason: 'too_short'; minimum: number }
  | { reason: 'too_long'; maximum: number }
  | { reason: 'breached' };

export type PasswordCheck =
  | { ok: true; breachCheckSkipped: boolean }
  | { ok: false; rejection: PasswordRejection };

/**
 * Shape-only validation. Synchronous, no network, so it is cheap to call first and cheap
 * to test exhaustively.
 */
export function validatePasswordShape(password: string): PasswordCheck {
  // Counting CODE POINTS, not UTF-16 units, so an emoji or an accented character counts
  // once rather than twice. Otherwise a passphrase of eight emoji would "pass" a
  // twelve-character minimum while being far weaker than it appears.
  const length = [...password].length;

  if (length < MIN_PASSWORD_LENGTH) {
    return { ok: false, rejection: { reason: 'too_short', minimum: MIN_PASSWORD_LENGTH } };
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_LENGTH) {
    return { ok: false, rejection: { reason: 'too_long', maximum: MAX_PASSWORD_LENGTH } };
  }

  return { ok: true, breachCheckSkipped: false };
}

/**
 * Full check: shape first, then the breach list.
 *
 * `breachCheckSkipped` is true when HIBP was unreachable. The password is accepted — see
 * checkBreachedPassword for why failing open is deliberate — but the caller can log that
 * the check did not actually run, so "we check breached passwords" never quietly becomes
 * false without anyone noticing.
 */
export async function validatePassword(password: string): Promise<PasswordCheck> {
  const shape = validatePasswordShape(password);
  if (!shape.ok) return shape;

  const breach = await checkBreachedPassword(password);

  if (breach.status === 'breached') {
    return { ok: false, rejection: { reason: 'breached' } };
  }

  return { ok: true, breachCheckSkipped: breach.status === 'unavailable' };
}

/** User-facing copy. Never names the breach count — that is a detail the user cannot act on. */
export function passwordRejectionMessage(rejection: PasswordRejection): string {
  switch (rejection.reason) {
    case 'too_short':
      return `Use at least ${rejection.minimum} characters. A memorable phrase works well.`;
    case 'too_long':
      return `That password is too long. Keep it under ${rejection.maximum} characters.`;
    case 'breached':
      return 'That password has appeared in a known data breach. Please choose a different one.';
  }
}
