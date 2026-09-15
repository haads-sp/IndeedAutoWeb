/**
 * Shown before the portal to any account that has not accepted the CURRENT Terms of Service and
 * Privacy Policy: an account created before Stage 11, one created without going through our
 * signup form, and every account after a policy's version changes (src/features/legal/policies.ts).
 *
 * Deliberately NOT a dead end. Someone who does not agree can still sign out, or delete their
 * account: refusing new terms must never trap a person inside an account they cannot leave.
 * /account/delete is not gated on consent for that reason.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { logOutAction } from '@/app/login/actions';
import { safeNext } from '@/features/auth/safe-redirect';
import { consentStatus } from '@/features/legal/acceptance';

import { requireVerifiedSession } from '../gates';
import { acceptPoliciesAction } from './actions';

const OUTCOME_MESSAGE: Record<string, string> = {
  not_confirmed: 'Tick the box to confirm you agree, or choose one of the other options below.',
  unavailable: 'That did not go through, because of a problem on our side. Please try again.',
};

export default async function AcceptTermsPage({ searchParams }: PageProps<'/accept-terms'>) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === 'string' ? params.next : null);
  const outcome = typeof params.outcome === 'string' ? params.outcome : null;
  const notice = outcome ? OUTCOME_MESSAGE[outcome] : null;

  // The same gate as ./layout.tsx, which makes a refusal a real 307 (../gates.ts).
  const session = await requireVerifiedSession('/accept-terms');

  const consent = await consentStatus(session.userId);

  if (consent.status === 'unavailable') {
    // Neither "accepted" nor "outstanding" can be assumed. The error page says something went
    // wrong, and the thrown detail goes to Sentry.
    throw new Error('Could not read policy acceptances for the acceptance page');
  }

  if (consent.status === 'accepted') {
    redirect(next);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Before you continue</h1>
        <p className="text-sm text-neutral-500">
          To use your account, please read and agree to the following:
        </p>
      </header>

      <ul className="flex flex-col gap-1 text-sm">
        {consent.outstanding.map(({ document, policy }) => (
          <li key={document}>
            <Link href={policy.path} className="underline underline-offset-2">
              {policy.title}
            </Link>
          </li>
        ))}
      </ul>

      {notice ? (
        <p
          role="alert"
          className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {notice}
        </p>
      ) : null}

      <form action={acceptPoliciesAction} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <label className="flex items-start gap-2 text-sm">
          <input name="confirm" type="checkbox" required className="mt-0.5" />
          <span>I have read and agree to the documents listed above.</span>
        </label>
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-sm text-white">
          Agree and continue
        </button>
      </form>

      <div className="flex flex-col gap-2 border-t border-neutral-200 pt-4 text-sm text-neutral-500">
        <p>If you do not agree, you can sign out or delete your account instead.</p>
        <div className="flex gap-4">
          <form action={logOutAction}>
            <button type="submit" className="underline underline-offset-2">
              Sign out
            </button>
          </form>
          <Link href="/account/delete" className="text-red-700 underline underline-offset-2">
            Delete my account
          </Link>
        </div>
      </div>
    </main>
  );
}
