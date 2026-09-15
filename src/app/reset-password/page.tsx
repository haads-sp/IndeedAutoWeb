/**
 * Choose a new password.
 *
 * Reachable only moments after following a reset link: the page requires a session that
 * proved inbox control within the recovery window. A session that signed in with a
 * PASSWORD cannot use this form — otherwise anyone at an unlocked, signed-in computer
 * could replace the password without knowing it.
 *
 * The page check is a convenience. completePasswordReset() repeats it, because a Server
 * Action is an endpoint that can be called without ever rendering this page.
 */

import { MIN_PASSWORD_LENGTH } from '@/features/auth/password';

import { requireFreshRecovery } from '../gates';
import { completeResetAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string; detail?: string }>;
}) {
  const { outcome, detail } = await searchParams;

  // The same gate as ./layout.tsx, which makes a refusal a real 307 (../gates.ts).
  await requireFreshRecovery();

  const notice =
    outcome === 'mismatch'
      ? 'Those passwords do not match.'
      : outcome === 'rejected'
        ? (detail ?? 'Please choose a different password.')
        : outcome === 'unavailable'
          ? 'Something went wrong on our side. Please try again.'
          : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Choose a new password</h1>
        <p className="text-sm text-neutral-500">
          Every device signed in to this account will be signed out when you save.
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

      <form action={completeResetAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          New password
          <input
            name="password"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            className="rounded border border-neutral-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Confirm new password
          <input
            name="confirm"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            className="rounded border border-neutral-300 px-3 py-2"
          />
        </label>
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-sm text-white">
          Save new password
        </button>
      </form>
    </main>
  );
}
