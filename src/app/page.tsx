/**
 * The landing page. BUILD-PLAN.md Stage 11. Replaces the Stage 1 placeholder (P8).
 *
 * Accounts only, by the owner's decision: it offers signing up and signing in, and says nothing
 * about what the product will be, because there is no product yet (see ./site.ts).
 *
 * It reads the session only to avoid offering "Create an account" to someone already signed in.
 * That is a convenience, not access control: every destination checks for itself.
 */

import Link from 'next/link';

import { currentSession } from '@/features/auth/session';

import { SITE_DESCRIPTION, SITE_NAME } from './site';
import { SiteFooter } from './site-footer';

export default async function HomePage() {
  const session = await currentSession();
  const signedIn = session.state === 'verified';

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{SITE_NAME}</h1>
        <p className="text-sm text-neutral-600">{SITE_DESCRIPTION}</p>
      </header>

      <nav aria-label="Account" className="flex flex-col gap-3">
        {signedIn ? (
          // prefetch={false}: prefetching a gated route runs its gate. See ./gates.ts.
          <Link
            href="/portal"
            prefetch={false}
            className="rounded bg-neutral-900 px-4 py-2 text-center text-sm text-white"
          >
            Go to your portal
          </Link>
        ) : (
          <>
            <Link
              href="/signup"
              className="rounded bg-neutral-900 px-4 py-2 text-center text-sm text-white"
            >
              Create an account
            </Link>
            <Link
              href="/login"
              className="rounded border border-neutral-300 px-4 py-2 text-center text-sm"
            >
              Sign in
            </Link>
          </>
        )}
      </nav>

      <SiteFooter />
    </main>
  );
}
