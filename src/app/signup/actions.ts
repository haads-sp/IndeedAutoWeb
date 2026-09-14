'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { signUp, type SignupOutcome } from '@/features/auth/signup';
import { logEvent } from '@/lib/logging/event';
import { clientIp } from '@/lib/request/client-ip';
import { correlationId } from '@/lib/request/correlation';

export async function signUpAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  const ip = clientIp(await headers());
  const result: SignupOutcome = await signUp(email, password, ip);

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
