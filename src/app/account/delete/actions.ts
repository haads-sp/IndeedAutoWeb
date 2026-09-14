'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { deleteOwnAccount } from '@/features/auth/delete-account';
import { clientIp } from '@/lib/request/client-ip';

export async function deleteAccountAction(formData: FormData): Promise<void> {
  const requestHeaders = await headers();

  const result = await deleteOwnAccount({
    password: String(formData.get('password') ?? ''),
    // Only the literal value the checkbox submits counts. An absent or altered field is
    // not consent.
    confirmed: formData.get('confirm') === 'yes',
    ip: clientIp(requestHeaders),
    userAgent: requestHeaders.get('user-agent'),
  });

  switch (result.outcome) {
    case 'deleted':
      redirect('/login?outcome=account_deleted');
    case 'not_signed_in':
      redirect('/login?next=/account/delete');
    case 'rate_limited':
      redirect(`/account/delete?outcome=rate_limited&retry=${result.retryAfterSeconds}`);
    default:
      redirect(`/account/delete?outcome=${result.outcome}`);
  }
}
