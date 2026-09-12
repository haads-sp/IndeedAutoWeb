/**
 * The "check your inbox" page, and where a failed confirmation link lands.
 *
 * Says the same thing to everyone. A visitor who already had an account sees this page,
 * exactly as a new signup does — that identical response is the point, and the reason
 * this page cannot show the address it "sent to" or any account-specific detail.
 */

import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const failed = state === 'invalid';
  const unconfirmed = state === 'unconfirmed';

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      {unconfirmed ? (
        <>
          <h1 className="text-lg font-semibold">Confirm your email first</h1>
          <p className="text-sm text-neutral-500">
            Your password was correct, but this address has not been confirmed yet. Open the
            link in the email we sent when you signed up.
          </p>
          <p className="text-xs text-neutral-400">
            Links expire. If yours has, sign up again with the same address to get a new one.
          </p>
        </>
      ) : failed ? (
        <>
          <h1 className="text-lg font-semibold">That link did not work</h1>
          <p className="text-sm text-neutral-500">
            Confirmation links expire, and each one can only be used once. Sign up again
            with the same address to get a fresh link.
          </p>
          <Link
            href="/signup"
            className="rounded bg-neutral-900 px-4 py-2 text-center text-sm text-white"
          >
            Get a new link
          </Link>
        </>
      ) : (
        <>
          <h1 className="text-lg font-semibold">Check your email</h1>
          <p className="text-sm text-neutral-500">
            If that address can be registered, a confirmation link is on its way. Open it to
            finish setting up your account.
          </p>
          <p className="text-xs text-neutral-400">
            Nothing arrived? Check your spam folder. The link expires, so request a new one
            if it has been a while.
          </p>
        </>
      )}
    </main>
  );
}
