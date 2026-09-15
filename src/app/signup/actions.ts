'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { signUp, type SignupConsent, type SignupOutcome } from '@/features/auth/signup';
import { signupAcceptanceMetadata } from '@/features/legal/policies';
import { logEvent } from '@/lib/logging/event';
import { clientIp } from '@/lib/request/client-ip';
import { correlationId } from '@/lib/request/correlation';

export async function signUpAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  // The checkbox is `required` in the browser, and checked again here: a request that did not
  // come from our form is not trusted to have shown anyone the policies. This route composes the
  // two features, because auth may not import legal (docs/ARCHITECTURE.md).
  const consent: SignupConsent =
    formData.get('accept_policies') === 'on'
      ? { accepted: true, metadata: signupAcceptanceMetadata() }
      : { accepted: false };

  const ip = clientIp(await headers());
  const result: SignupOutcome = await signUp(email, password, ip, consent);

  logEvent({
    event: 'auth.signup',
    // 'verification_sent' for registered and unregistered addresses alike: the log carries
    // no more than the page does, so the logs cannot become the oracle either.
    outcome: result.outcome,
    correlationId: await correlationId(),
    ip,
  });

  switch (result.outcome) {
    case 'verification_sent':
      // Carries NO information about whether the account already existed, because
      // signUp() does not know either — by design.
      redirect('/verify-email?state=sent');
    case 'password_rejected':
      redirect(`/signup?outcome=password_rejected&detail=${encodeURIComponent(result.message)}`);
    case 'rate_limited':
      redirect(`/signup?outcome=rate_limited&retry=${result.retryAfterSeconds}`);
    default:
      redirect(`/signup?outcome=${result.outcome}`);
  }
}
