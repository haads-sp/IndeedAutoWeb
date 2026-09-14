'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { logIn, logOut } from '@/features/auth/login';
import { safeNext } from '@/features/auth/safe-redirect';
import { logEvent } from '@/lib/logging/event';
import { clientIp } from '@/lib/request/client-ip';
import { correlationId } from '@/lib/request/correlation';

export async function logInAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const next = safeNext(String(formData.get('next') ?? ''));

  const ip = clientIp(await headers());
  const result = await logIn(email, password, ip);

  // Before any redirect: redirect() throws, and nothing after it runs. The address is
  // deliberately NOT logged — see src/lib/logging/event.ts.
  logEvent({
    event: 'auth.sign_in',
    outcome: result.outcome,
    correlationId: await correlationId(),
    ip,
  });

  switch (result.outcome) {
    case 'signed_in':
      redirect(next);
    case 'email_not_confirmed':
      redirect('/verify-email?state=unconfirmed');
    case 'rate_limited':
      redirect(`/login?outcome=rate_limited&retry=${result.retryAfterSeconds}`);
    default:
      // invalid_credentials, missing_fields and unavailable all land here. The first two
      // deliberately share a message: distinguishing "no such account" from "wrong
      // password" is an enumeration oracle.
      redirect(`/login?outcome=${result.outcome}`);
  }
}

export async function logOutAction(): Promise<void> {
  await logOut();

  logEvent({
    event: 'auth.sign_out',
    outcome: 'signed_out',
    correlationId: await correlationId(),
    ip: clientIp(await headers()),
  });

  redirect('/login?outcome=signed_out');
}
