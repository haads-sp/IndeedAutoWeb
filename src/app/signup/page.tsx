/**
 * Signup. Email and password only — social login is Phase 2 (docs/DECISIONS.md).
 *
 * Server Action form, so no client JavaScript is involved in creating an account.
 */

import Link from 'next/link';

import { MIN_PASSWORD_LENGTH } from '@/features/auth/password';

import { signUpAction } from './actions';

export const dynamic = 'force-dynamic';

const OUTCOME_MESSAGE: Record<string, string> = {
  invalid_email: 'That does not look like an email address.',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
  unavailable: 'Something went wrong on our side. Please try again.',
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string; detail?: string }>;
}) {
  const { outcome, detail } = await searchParams;

  const notice =
    outcome === 'password_rejected'
      ? (detail ?? 'Please choose a different password.')
      : outcome
        ? OUTCOME_MESSAGE[outcome]
        : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Create an account</h1>
        <p className="text-sm text-neutral-500">
          You will need to confirm your email address before you can sign in.
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

      <form action={signUpAction} className="flex flex-col gap-4">
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
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            className="rounded border border-neutral-300 px-3 py-2"
          />
          <span className="text-xs text-neutral-500">
            At least {MIN_PASSWORD_LENGTH} characters. A memorable phrase of a few words is
            stronger than a short password with symbols in it — and we check against known
            breached passwords, so avoid anything you have used elsewhere.
          </span>
        </label>

        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-sm text-white">
          Create account
        </button>
      </form>

      <p className="text-sm text-neutral-500">
        Already have an account?{' '}
        <Link href="/login" className="underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </main>
  );
}
