/**
 * Delete your account.
 *
 * BUILD-PLAN.md Stage 8: "Safe default is the reversible branch." Nothing on this page
 * happens by default — it takes the current password AND an explicit confirmation, and
 * even then the result is a soft delete that an administrator can reverse during the
 * grace period.
 */

import Link from 'next/link';

import { DATA_DELETION_POLICY } from '@/features/legal/policies';

import { requireVerifiedSession } from '../../gates';
import { deleteAccountAction } from './actions';

export const dynamic = 'force-dynamic';

const OUTCOME_MESSAGE: Record<string, string> = {
  wrong_password: 'That password is not correct. Your account has not been deleted.',
  not_confirmed: 'Tick the box to confirm. Your account has not been deleted.',
  unavailable: 'Something went wrong on our side. Your account has not been deleted.',
};

export default async function DeleteAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string; retry?: string }>;
}) {
  const { outcome, retry } = await searchParams;

  // The same gate as ./layout.tsx, which makes a refusal a real 307 (../../gates.ts).
  await requireVerifiedSession('/account/delete');

  const notice =
    outcome === 'rate_limited'
      ? `Too many attempts. Try again in ${formatRetry(retry)}. Your account has not been deleted.`
      : outcome
        ? OUTCOME_MESSAGE[outcome]
        : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold">Delete your account</h1>
        <p className="text-sm text-neutral-600">
          Your account will be closed immediately and you will be signed out on every device.
        </p>
        {/*
          Deliberately promises nothing the system does not do. Purging after the grace
          period is a MANUAL admin function today — nothing schedules it — so this page
          must not claim data is "permanently removed after 30 days". Nor does it offer a
          support contact, because none exists. See docs/DECISIONS.md.
        */}
        <p className="text-sm text-neutral-600">
          Your data is kept for at least 30 days in case this was a mistake. See the{' '}
          <Link href={DATA_DELETION_POLICY.path} className="underline underline-offset-2">
            {DATA_DELETION_POLICY.title}
          </Link>
          .
        </p>
      </header>

      {notice ? (
        <p
          role="alert"
          className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {notice}
        </p>
      ) : null}

      <form action={deleteAccountAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Current password
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="rounded border border-neutral-300 px-3 py-2"
          />
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input name="confirm" type="checkbox" value="yes" required className="mt-1" />
          <span>I understand my account will be closed and I will be signed out everywhere.</span>
        </label>

        <button type="submit" className="rounded bg-red-700 px-4 py-2 text-sm text-white">
          Delete my account
        </button>
      </form>

      {/* prefetch={false}: prefetching a gated route runs its gate. See ../../gates.ts. */}
      <Link href="/portal" prefetch={false} className="text-sm underline underline-offset-2">
        Keep my account
      </Link>
    </main>
  );
}

function formatRetry(retry: string | undefined): string {
  const seconds = Number.parseInt(retry ?? '', 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return 'a few minutes';
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
