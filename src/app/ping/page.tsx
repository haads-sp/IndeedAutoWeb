/**
 * STUB (Stage 5): the Stage 2 walking skeleton, now the post-login landing page until
 * /portal replaces it. Deleted in the same commit as its replacement (prohibition P8).
 *
 * Its sign-in form and auth actions were removed in Stage 4 — deleted in the same commit
 * as /login arrived, which is the other half of P8.
 *
 * This is STILL not a protected route. It redirects an anonymous visitor to /login as a
 * convenience, not as a security boundary; the boundary is the RLS policy on `ping`
 * (prohibition P2). Real route protection arrives in Stage 5, and even then the redirect
 * is not what makes the data safe.
 */

import { redirect } from 'next/navigation';

import { logOutAction } from '@/app/login/actions';
import { createClient } from '@/lib/supabase/server';

import { addPing } from './write-action';

export const dynamic = 'force-dynamic';

const OUTCOME_MESSAGE: Record<string, string> = {
  message_invalid: 'A message must be between 1 and 280 characters.',
  write_failed: 'Could not save that. Please try again.',
};

export default async function PingPage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string }>;
}) {
  const { outcome } = await searchParams;
  const notice = outcome ? OUTCOME_MESSAGE[outcome] : null;

  const supabase = await createClient();

  // getClaims() verifies the JWT signature. getSession() would not. BUILD-PLAN.md §4.3.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims ?? null;

  if (!claims) {
    redirect('/login?next=/ping');
  }

  // No .eq('user_id', ...) here, deliberately: the RLS SELECT policy is what scopes this.
  // That is what lets Stage 6 disprove it with a real second user rather than by reading
  // one line of TypeScript.
  const { data: pings, error } = await supabase
    .from('ping')
    .select('id, message, created_at')
    .order('created_at', { ascending: false });

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Walking skeleton</h1>
        <p className="text-sm text-neutral-500">
          Placeholder until the portal is built in Stage 5.
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

      <section className="flex items-center justify-between gap-4 rounded border border-neutral-200 px-3 py-2">
        <p className="truncate text-sm">
          Signed in as <span className="font-medium">{String(claims.email ?? claims.sub)}</span>
        </p>
        <form action={logOutAction}>
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
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-sm text-white">
          Write
        </button>
      </form>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Your rows</h2>
        {error ? (
          // P3: generic message to the user; the real error is not rendered.
          <p className="text-sm text-neutral-500">Could not load rows.</p>
        ) : pings && pings.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {pings.map((ping) => (
              <li
                key={ping.id}
                className="flex justify-between gap-4 rounded border border-neutral-200 px-3 py-2 text-sm"
              >
                <span className="break-words">{ping.message}</span>
                <time dateTime={ping.created_at} className="shrink-0 text-xs text-neutral-400">
                  {new Date(ping.created_at).toISOString().slice(0, 19).replace('T', ' ')}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-500">No rows yet.</p>
        )}
      </section>
    </main>
  );
}
