/**
 * Consumes the link in a verification email.
 *
 * The email template points here with a `token_hash`, NOT at Supabase's default
 * `ConfirmationURL`. The reason is the server-side session: `verifyOtp` runs here, on the
 * server, so the resulting session is written as an HttpOnly cookie by our own server
 * client. The default flow puts tokens in a URL fragment for client-side JavaScript to
 * pick up, which cannot set an HttpOnly cookie and leaves the token in browser history.
 *
 * The exact template this expects is recorded in docs/EXTENDING.md.
 */

import { type EmailOtpType } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/features/auth/safe-redirect';

/** Only the types this app actually issues. An unexpected value is rejected, not passed through. */
const ALLOWED_TYPES: readonly EmailOtpType[] = ['email', 'signup', 'recovery', 'email_change'];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const next = searchParams.get('next');

  if (!tokenHash || !type || !ALLOWED_TYPES.includes(type as EmailOtpType)) {
    redirect('/verify-email?state=invalid');
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type: type as EmailOtpType,
    token_hash: tokenHash,
  });

  if (error) {
    // Expired and already-used tokens both land here. The distinction is not shown to the
    // user, who can do the same thing either way: request a new link.
    redirect('/verify-email?state=invalid');
  }

  // Only ever redirect to a path on this origin. Taking `next` verbatim would make this
  // an open redirect: a crafted link in an email that authenticates the user and then
  // sends them to an attacker's page.
  redirect(safeNext(next));
}

