'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { confirmLink } from '@/features/auth/confirm-link';
import { logEvent } from '@/lib/logging/event';
import { clientIp } from '@/lib/request/client-ip';
import { correlationId } from '@/lib/request/correlation';

/**
 * Step 2 of an email link: spends the single-use token. See src/features/auth/confirm-link.ts
 * for why this is a POST behind a button rather than the GET that opened the page.
 */
export async function confirmLinkAction(formData: FormData): Promise<void> {
  const type = formData.get('type');

  const result = await confirmLink({
    tokenHash: formData.get('token_hash'),
    type,
    next: formData.get('next'),
  });

  // Before the redirect: redirect() throws, and nothing after it runs. The token is
  // deliberately NOT logged. It is a credential until it is spent.
  logEvent({
    event: 'auth.confirm_link',
    outcome: result.outcome,
    correlationId: await correlationId(),
    ip: clientIp(await headers()),
    detail: { type: typeof type === 'string' ? type.slice(0, 32) : null },
  });

  redirect(result.destination);
}
