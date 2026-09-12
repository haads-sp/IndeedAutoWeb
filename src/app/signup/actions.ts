'use server';

import { redirect } from 'next/navigation';

import { signUp, type SignupOutcome } from '@/features/auth/signup';

export async function signUpAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  const result: SignupOutcome = await signUp(email, password);

  if (result.outcome === 'verification_sent') {
    // Note the redirect carries NO information about whether the account already
    // existed, because signUp() does not know either — by design.
    redirect('/verify-email?state=sent');
  }

  if (result.outcome === 'password_rejected') {
    redirect(`/signup?outcome=password_rejected&detail=${encodeURIComponent(result.message)}`);
  }

  redirect(`/signup?outcome=${result.outcome}`);
}
