'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { requestPasswordReset } from '@/features/auth/password-reset';
import { logEvent } from '@/lib/logging/event';
import { clientIp } from '@/lib/request/client-ip';
import { correlationId } from '@/lib/request/correlation';

export async function requestResetAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '');
  const ip = clientIp(await headers());
  const result = await requestPasswordReset(email, ip);

  logEvent({
    event: 'auth.password_reset_requested',
    // 'reset_requested' is logged for known and unknown addresses alike, because the
    // feature cannot tell them apart. The log carries no more than the page does.
    outcome: result.outcome,
    correlationId: await correlationId(),
    ip,
  });

  switch (result.outcome) {
    case 'reset_requested':
      // Carries no information about whether an account exists, because the feature
      // module deliberately does not know either.
      redirect('/forgot-password?outcome=sent');
    case 'rate_limited':
      redirect(`/forgot-password?outcome=rate_limited&retry=${result.retryAfterSeconds}`);
    case 'invalid_email':
      redirect('/forgot-password?outcome=invalid_email');
  }
}
