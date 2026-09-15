'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { safeNext } from '@/features/auth/safe-redirect';
import { acceptCurrentPolicies } from '@/features/legal/acceptance';
import { logEvent } from '@/lib/logging/event';
import { clientIp } from '@/lib/request/client-ip';
import { correlationId } from '@/lib/request/correlation';

/**
 * Records acceptance of the current Terms and Privacy Policy. Everything the page checked is
 * checked again by the database function this calls: a live session, a verified address, an
 * active account. The page is a convenience; accept_policies() is the rule.
 */
export async function acceptPoliciesAction(formData: FormData): Promise<void> {
  const next = safeNext(String(formData.get('next') ?? ''));
  const result = await acceptCurrentPolicies(formData.get('confirm') === 'on');

  logEvent({
    event: 'legal.policies_accepted',
    outcome: result.outcome,
    correlationId: await correlationId(),
    userId: result.outcome === 'accepted' ? result.userId : null,
    ip: clientIp(await headers()),
    detail: result.outcome === 'accepted' ? { recorded: result.recorded } : undefined,
  });

  switch (result.outcome) {
    case 'accepted':
      redirect(next);
    case 'not_permitted':
      // No live, verified, active session. The login page sorts out which.
      redirect(`/login?next=${encodeURIComponent('/accept-terms')}`);
    default:
      redirect(`/accept-terms?outcome=${result.outcome}&next=${encodeURIComponent(next)}`);
  }
}
