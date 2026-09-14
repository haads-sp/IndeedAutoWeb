/**
 * Sign in.
 *
 * Replaces the sign-in form that lived inside /ping during Stage 2, which is deleted in
 * the same commit as this file arrives (prohibition P8).
 *
 * Server Action form: no client JavaScript participates in authentication, and the session
 * cookie is written by the server on a normal POST.
 */

import Link from 'next/link';

import { logInAction } from './actions';

export const dynamic = 'force-dynamic';

const OUTCOME_MESSAGE: Record<string, string> = {
  // One message for both "no such account" and "wrong password", on purpose.
  invalid_credentials: 'That email and password do not match.',
  missing_fields: 'Enter both an email and a password.',
  unavailable: 'Something went wrong on our side. Please try again.',
  signed_out: 'You have been signed out.',
  password_reset:
    'Your password has been changed and every device has been signed out. Sign in with your new password.',
  // Deliberately NOT the same message as above. The password did change, but signing out
  // the other sessions did not complete, and saying it did would be a false claim about
  // the user's security (P7).
  password_reset_sessions_uncertain:
    'Your password has been changed, but we could not confirm your other devices were signed out. Sign in, then reset your password again to be sure.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string; retry?: string; next?: string }>;
}) {
  const { outcome, retry, next } = await searchParams;

  const notice =
    outcome === 'rate_limited'
      ? `Too many attempts. Try again in ${formatRetry(retry)}.`
      : outcome
        ? OUTCOME_MESSAGE[outcome]
        : null;

  const isNeutral = outcome === 'signed_out' || outcome === 'password_reset';

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Sign in</h1>
      </header>

      {notice ? (
        <p
          role={isNeutral ? 'status' : 'alert'}
          className={
            isNeutral
              ? 'rounded border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-700'
              : 'rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900'
          }
        >
          {notice}
        </p>
      ) : null}

      <form action={logInAction} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next ?? ''} />

        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="rounded border border-neutral-300 px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="rounded border border-neutral-300 px-3 py-2"
          />
        </label>

        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-sm text-white">
          Sign in
        </button>
      </form>

      <p className="text-sm text-neutral-500">
        <Link href="/forgot-password" className="underline underline-offset-2">
          Forgot your password?
        </Link>
      </p>

      <p className="text-sm text-neutral-500">
        No account?{' '}
        <Link href="/signup" className="underline underline-offset-2">
          Create one
        </Link>
      </p>
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
