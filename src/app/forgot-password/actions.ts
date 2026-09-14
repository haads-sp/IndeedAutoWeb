'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { requestPasswordReset } from '@/features/auth/password-reset';
import { clientIp } from '@/lib/request/client-ip';

export async function requestResetAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '');
  const result = await requestPasswordReset(email, clientIp(await headers()));

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
