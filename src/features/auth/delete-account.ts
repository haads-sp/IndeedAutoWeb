import 'server-only';

/**
 * Account deletion.
 *
 * BUILD-PLAN.md Stage 8: "The irreversible action. Safe default is the reversible branch."
 *
 * So this never deletes anything. It sets profiles.deleted_at, which revokes access at once
 * while keeping the data through a grace window. The irreversible branch — actually
 * removing the user — is admin_purge_deleted_accounts(), a SQL function no client can call.
 *
 * Every protection is enforced in TWO places, application and database, because the
 * database function is reachable directly through the Data API:
 *
 * | Requirement            | Here                          | In soft_delete_own_account()      |
 * |------------------------|-------------------------------|-----------------------------------|
 * | Re-authentication      | password checked by sign-in   | password sign-in within 5 minutes |
 * | Only your own account  | session.userId                | auth.uid()                        |
 * | Live session           | currentSession()              | session_is_active()               |
 * | Audit row              | —                             | written only if a row changed     |
 */

import { createClient } from '@/lib/supabase/server';

import { checkRateLimit } from './rate-limit';
import { currentSession } from './session';

export type DeleteAccountOutcome =
  | { outcome: 'deleted' }
  | { outcome: 'not_signed_in' }
  | { outcome: 'not_confirmed' }
  | { outcome: 'wrong_password' }
  | { outcome: 'rate_limited'; retryAfterSeconds: number }
  | { outcome: 'unavailable' };

export interface DeleteAccountRequest {
  readonly password: string;
  /** The explicit "I understand" confirmation. The default must be the reversible branch. */
  readonly confirmed: boolean;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export async function deleteOwnAccount(request: DeleteAccountRequest): Promise<DeleteAccountOutcome> {
  if (!request.confirmed) {
    return { outcome: 'not_confirmed' };
  }

  const session = await currentSession();
  if (session.state !== 'verified' || !session.email) {
    return { outcome: 'not_signed_in' };
  }

  // The LOGIN budget, deliberately — not a separate one. This form checks a password, so a
  // fresh budget here would be a second, parallel password-guessing endpoint for anyone
  // who found a signed-in session. Keyed on the session's own address, never on input.
  const decision = await checkRateLimit('login', session.email, request.ip);
  if (!decision.allowed) {
    return { outcome: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds };
  }

  const supabase = await createClient();

  // Re-authentication. A successful sign-in mints a token whose amr records a PASSWORD
  // sign-in right now, which is what soft_delete_own_account() insists on seeing.
  const { data: reauth, error: reauthError } = await supabase.auth.signInWithPassword({
    email: session.email,
    password: request.password,
  });

  if (reauthError || reauth.user?.id !== session.userId) {
    // The id comparison is cheap insurance that the password was checked against the
    // account being deleted and no other.
    return { outcome: 'wrong_password' };
  }

  const { data: deleted, error: deleteError } = await supabase.rpc('soft_delete_own_account', {
    p_ip: request.ip,
    p_user_agent: request.userAgent,
  });

  if (deleteError || deleted !== true) {
    // Nothing was marked, so sessions are deliberately left alone: signing someone out
    // everywhere for a deletion that did not happen would be a punishment for our error.
    return { outcome: 'unavailable' };
  }

  // Access revoked immediately. If this fails, access is STILL refused — currentSession()
  // reports 'deleted' and every profiles policy requires deleted_at is null — so the
  // deletion is not reported as failed when it succeeded.
  await supabase.auth.signOut({ scope: 'global' });

  return { outcome: 'deleted' };
}
