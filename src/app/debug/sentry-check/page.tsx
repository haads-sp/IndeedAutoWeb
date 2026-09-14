// STUB (Stage 10 gate): deleted in the commit that records the gate. Prohibition P8.

/**
 * Throws, on purpose, so the Stage 10 gate can be observed in production: "Force an error in
 * production. The user-visible page is friendly and the trace is in Sentry."
 *
 * Verified users only. Not a button for strangers to spend the error quota with, and the
 * request that fails then carries real session cookies, which is what makes "no cookie reached
 * Sentry" a meaningful thing to check.
 *
 * The message deliberately contains FAKE sensitive-looking values, assembled at run time (a
 * JWT-shaped literal would trip gitleaks): an email address, a JWT and a link token. The gate
 * checks that each one arrives in Sentry scrubbed.
 */

import { redirect } from 'next/navigation';

import { currentSession } from '@/features/auth/session';

export const dynamic = 'force-dynamic';

export default async function SentryCheckPage() {
  const session = await currentSession();
  if (session.state !== 'verified') {
    redirect('/login?next=/debug/sentry-check');
  }

  const fakeJwt = [{ alg: 'ES256', typ: 'JWT' }, { sub: 'stage-10-gate-probe' }]
    .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
    .concat(Buffer.from('not-a-real-signature').toString('base64url'))
    .join('.');

  throw new Error(
    'Stage 10 gate: deliberate server error. Fake probe values, which must arrive scrubbed: ' +
      `email gate.probe@example.com, token ${fakeJwt}, ` +
      'link /auth/confirm?token_hash=FAKEgateprobe123&type=email',
  );
}
