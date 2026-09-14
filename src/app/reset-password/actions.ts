'use server';

import { redirect } from 'next/navigation';

import { completePasswordReset } from '@/features/auth/password-reset';

export async function completeResetAction(formData: FormData): Promise<void> {
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (password !== confirm) {
    redirect('/reset-password?outcome=mismatch');
  }

  const result = await completePasswordReset(password);

  switch (result.outcome) {
    case 'password_updated':
      redirect('/login?outcome=password_reset');
    case 'password_updated_sessions_uncertain':
      redirect('/login?outcome=password_reset_sessions_uncertain');
    case 'no_recovery_session':
      redirect('/forgot-password?outcome=link_expired');
    case 'password_rejected':
      redirect(`/reset-password?outcome=rejected&detail=${encodeURIComponent(result.message)}`);
    case 'unavailable':
      redirect('/reset-password?outcome=unavailable');
  }
}
