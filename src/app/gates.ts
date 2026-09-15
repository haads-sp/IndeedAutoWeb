import 'server-only';

/**
 * Route gates, called by a protected route's layout.tsx AND its page.tsx.
 *
 * WHY THE LAYOUT. A route with a loading.tsx streams: its loading state is sent first, so a
 * redirect() thrown later inside the page can no longer set the HTTP status. Next.js falls back to
 * a 200 carrying the loading skeleton and a <meta http-equiv="refresh">. That is what Stage 10's
 * loading states did to every protected route: a signed-out request for /portal got 200. Browsers
 * followed the refresh, so the E2E suite never saw it (docs/ISSUES.md row 8). A layout renders
 * OUTSIDE its own segment's loading boundary, so a redirect there happens before anything is sent,
 * and is a real 307. docs/DOMAIN.md.
 *
 * WHY THE PAGE TOO. For its own type narrowing, and so the check survives someone moving or
 * deleting the layout. cache() makes the second call free within a request.
 *
 * Neither is the security boundary (P2). The data behind these routes is protected by RLS.
 *
 * Rendering only. Server Actions call currentSession() directly: an answer cached for the duration
 * of an action that signs someone out would be stale by its end.
 */

import { redirect } from 'next/navigation';
import { cache } from 'react';

import { hasFreshRecovery } from '@/features/auth/password-reset';
import { currentSession, type SessionState } from '@/features/auth/session';
import { consentStatus } from '@/features/legal/acceptance';
import { createClient } from '@/lib/supabase/server';

const sessionForRender = cache(currentSession);
const consentForRender = cache(consentStatus);

export type VerifiedSession = Extract<SessionState, { state: 'verified' }>;

/**
 * A signed-in, verified, not-deleted account, or a redirect. Three different destinations for
 * three different states: collapsing them is the mistake BUILD-PLAN.md §7 warns about.
 *
 * `returnTo` is always a constant path chosen by the caller, never user input.
 */
export async function requireVerifiedSession(returnTo: string): Promise<VerifiedSession> {
  const session = await sessionForRender();

  if (session.state === 'anonymous') redirect(`/login?next=${returnTo}`);
  if (session.state === 'unverified') redirect('/verify-email?state=unconfirmed');
  if (session.state === 'deleted') redirect('/login?outcome=account_deleted');

  return session;
}

/**
 * The current Terms and Privacy Policy accepted, or a redirect to /accept-terms. A ledger that
 * cannot be read is an error, never a pass and never a redirect (see consentStatus()).
 */
export async function requireAcceptedPolicies(session: VerifiedSession, returnTo: string) {
  const consent = await consentForRender(session.userId);

  if (consent.status === 'unavailable') {
    throw new Error('Could not read policy acceptances');
  }
  if (consent.status === 'outstanding') {
    redirect(`/accept-terms?next=${returnTo}`);
  }

  return consent;
}

/**
 * /reset-password only: a session that proved control of the inbox within the recovery window.
 * A password session does not qualify. See hasFreshRecovery().
 */
export const requireFreshRecovery = cache(async (): Promise<void> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims?.sub || !hasFreshRecovery(claims.amr)) {
    redirect('/forgot-password?outcome=link_expired');
  }
});
