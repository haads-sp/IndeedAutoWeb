/**
 * STUB (Stage 5): the Stage 2 walking skeleton. Deleted when `/portal` and the real
 * `profiles` table land, in the same commit as its replacement (prohibition P8).
 *
 * The thinnest end-to-end path, and nothing more: a request arrives, a real Supabase user
 * authenticates, one row is written, it is read back scoped to that user, it renders.
 *
 * This is NOT a protected route and must not be mistaken for one. It renders a sign-in
 * form to anonymous visitors rather than redirecting. Route protection is Stage 5 and the
 * boundary that actually matters is the RLS policy, not this page (prohibition P2).
 */

import { createClient } from '@/lib/supabase/server';

import { addPing, signIn, signOut, type PingOutcome } from './actions';

export const dynamic = 'force-dynamic';

/** User-facing copy, keyed by the same enum the actions return. One vocabulary. */
const OUTCOME_MESSAGE: Record<PingOutcome, string> = {
  invalid_credentials: 'That email and password did not match.',
  missing_fields: 'Enter both an email and a password.',
  message_invalid: 'A message must be between 1 and 280 characters.',
  not_signed_in: 'You need to be signed in to do that.',
  write_failed: 'Could not save that. Please try again.',
};

function isOutcome(value: string | undefined): value is PingOutcome {
  return value !== undefined && value in OUTCOME_MESSAGE;
}

export default async function PingPage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string }>;
}) {
  const { outcome } = await searchParams;
  const notice = isOutcome(outcome) ? OUTCOME_MESSAGE[outcome] : null;

  const supabase = await createClient();

  // getClaims() verifies the JWT signature. getSession() would not. BUILD-PLAN.md §4.3.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims ?? null;

  // Read back, scoped to the user. Note there is no .eq('user_id', ...) here: the RLS
  // SELECT policy is what limits this to the caller's own rows. That is deliberate — it
  // means Stage 6 can prove the policy works by querying as a second user and getting
  // zero rows, rather than proving that this one line of TypeScript is correct.
  const { data: pings, error } = claims
    ? await supabase.from('ping').select('id, message, created_at').order('created_at', {
        ascending: false,
      })
    : { data: null, error: null };

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Walking skeleton</h1>
        <p className="text-sm text-neutral-500">
          Stage 2. Proves one row can be written and read back, scoped to its owner,
          against the real Supabase project. It does nothing useful on purpose.
        </p>
      </header>

      {notice ? (
        <p
          role="status"
          className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {notice}
        </p>
      ) : null}

      {claims ? (
        <>
          <section className="flex items-center justify-between gap-4 rounded border border-neutral-200 px-3 py-2">
            <p className="truncate text-sm">
              Signed in as <span className="font-medium">{String(claims.email ?? claims.sub)}</span>
            </p>
            <form action={signOut}>
              <button type="submit" className="text-sm underline underline-offset-2">
                Sign out
              </button>
            </form>
          </section>

          <form action={addPing} className="flex gap-2">
            <label htmlFor="message" className="sr-only">
              Message
            </label>
            <input
              id="message"
              name="message"
              type="text"
              required
              maxLength={280}
              placeholder="Write one row"
              className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded bg-neutral-900 px-4 py-2 text-sm text-white"
            >
              Write
            </button>
          </form>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Your rows</h2>
            {error ? (
              // P3: the user gets a generic message; the real error is not rendered.
              <p className="text-sm text-neutral-500">Could not load rows.</p>
            ) : pings && pings.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {pings.map((ping) => (
                  <li
                    key={ping.id}
                    className="flex justify-between gap-4 rounded border border-neutral-200 px-3 py-2 text-sm"
                  >
                    <span className="break-words">{ping.message}</span>
                    <time
                      dateTime={ping.created_at}
                      className="shrink-0 text-xs text-neutral-400"
                    >
                      {new Date(ping.created_at).toISOString().slice(0, 19).replace('T', ' ')}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-neutral-500">No rows yet.</p>
            )}
          </section>
        </>
      ) : (
        <form action={signIn} className="flex flex-col gap-3">
          <p className="text-sm text-neutral-500">
            Sign in with the user created by hand in the Supabase dashboard. There is no
            signup here — that is Stage 3.
          </p>
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
          <button
            type="submit"
            className="rounded bg-neutral-900 px-4 py-2 text-sm text-white"
          >
            Sign in
          </button>
        </form>
      )}
    </main>
  );
}
