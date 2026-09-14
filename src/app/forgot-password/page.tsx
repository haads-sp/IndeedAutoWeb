/**
 * Request a password reset.
 *
 * Says the same thing for every address, registered or not. The person who owns a real
 * account learns the truth from their inbox, which is the one place an attacker is not.
 */

import Link from 'next/link';

import { requestResetAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string; retry?: string }>;
}) {
  const { outcome, retry } = await searchParams;

  if (outcome === 'sent') {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
        <h1 className="text-lg font-semibold">Check your email</h1>
        <p className="text-sm text-neutral-500">
          If an account exists for that address, a link to reset your password is on its way.
        </p>
        <p className="text-xs text-neutral-400">
          The link works once and expires. Nothing arrived? Check your spam folder, then
          request another.
        </p>
        <Link href="/login" className="text-sm underline underline-offset-2">
          Back to sign in
        </Link>
      </main>
    );
  }

  const notice =
    outcome === 'rate_limited'
      ? `Too many requests. Try again in ${formatRetry(retry)}.`
      : outcome === 'invalid_email'
        ? 'That does not look like an email address.'
        : outcome === 'link_expired'
          ? 'That reset link has expired or has already been used. Request a new one.'
          : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Reset your password</h1>
        <p className="text-sm text-neutral-500">
          Enter your email and we will send you a link to choose a new password.
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

      <form action={requestResetAction} className="flex flex-col gap-4">
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
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-sm text-white">
          Send reset link
        </button>
      </form>

      <Link href="/login" className="text-sm underline underline-offset-2">
        Back to sign in
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
