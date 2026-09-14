/**
 * Step 1 of an email link: a page with a button. Opening it changes nothing.
 *
 * The link in the email (docs/EXTENDING.md) points here. The token is only spent when the
 * button is pressed, by ./actions.ts. See src/features/auth/confirm-link.ts for why: mail
 * scanners that open links, and login CSRF.
 */

import { redirect } from 'next/navigation';

import { parseConfirmLink, type ConfirmableType } from '@/features/auth/confirm-link';

import { confirmLinkAction } from './actions';

const COPY: Record<ConfirmableType, { heading: string; body: string; button: string }> = {
  email: {
    heading: 'Confirm your email',
    body: 'Press the button to confirm this address and sign in.',
    button: 'Confirm email',
  },
  signup: {
    heading: 'Confirm your email',
    body: 'Press the button to confirm this address and sign in.',
    button: 'Confirm email',
  },
  recovery: {
    heading: 'Reset your password',
    body: 'Press the button to continue. You will choose a new password on the next page.',
    button: 'Continue',
  },
  email_change: {
    heading: 'Confirm your new email address',
    body: 'Press the button to start using this address for your account.',
    button: 'Confirm new address',
  },
};

/** A repeated query parameter arrives as an array. Only a single value is a link. */
function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export default async function ConfirmPage({ searchParams }: PageProps<'/auth/confirm'>) {
  const params = await searchParams;

  const parsed = parseConfirmLink({
    tokenHash: single(params.token_hash),
    type: single(params.type),
    next: single(params.next),
  });

  // A malformed link is refused immediately. Safe on a GET: redirecting spends nothing.
  if (!parsed.ok) {
    redirect(parsed.destination);
  }

  const { link } = parsed;
  const copy = COPY[link.type];
  const unavailable = single(params.outcome) === 'unavailable';

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold">{copy.heading}</h1>
        <p className="text-sm text-neutral-500">{copy.body}</p>
      </div>

      {unavailable ? (
        <p
          role="status"
          className="rounded border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-700"
        >
          That did not go through, because of a problem on our side. Please try again in a
          moment. If it keeps failing, request a new link.
        </p>
      ) : null}

      <form action={confirmLinkAction} className="flex flex-col gap-3">
        <input type="hidden" name="token_hash" value={link.tokenHash} />
        <input type="hidden" name="type" value={link.type} />
        <input type="hidden" name="next" value={link.next} />
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-sm text-white">
          {copy.button}
        </button>
      </form>
    </main>
  );
}
