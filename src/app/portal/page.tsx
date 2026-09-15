/**
 * The portal. Reachable only by a signed-in, VERIFIED user.
 *
 * Replaces /ping, which is deleted in the same commit (prohibition P8).
 *
 * The two redirects below are UX, not security. What actually protects the data is the
 * RLS policy on `profiles` — `auth.uid() = id` — which holds whether or not this page
 * renders (prohibition P2). Stage 6 proves that with a second real user.
 *
 * Deliberately a placeholder. BUILD-PLAN.md Stage 5: "The portal contains a placeholder.
 * Do not invent product features."
 */

import Link from 'next/link';

import { ACCEPTED_DOCUMENTS, CURRENT_POLICIES } from '@/features/legal/policies';
import { logOutAction } from '@/app/login/actions';
import { createClient } from '@/lib/supabase/server';

import { requireAcceptedPolicies, requireVerifiedSession } from '../gates';
import { updateDisplayName } from './actions';

export const dynamic = 'force-dynamic';

const OUTCOME_MESSAGE: Record<string, string> = {
  saved: 'Saved.',
  name_too_long: 'That name is too long. Keep it under 80 characters.',
  save_failed: 'Could not save that. Please try again.',
};

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string }>;
}) {
  const { outcome } = await searchParams;
  const notice = outcome ? OUTCOME_MESSAGE[outcome] : null;

  // The same gates as ./layout.tsx, which is what makes a refusal a real 307 (../gates.ts). Run
  // again here for narrowing, and so the check survives the layout moving; cached, so free.
  //
  // Verified, not merely signed in: BUILD-PLAN.md §7, "a user who signed up but never clicked the
  // link has a valid session and is not a verified user."
  //
  // Stage 11: and the current Terms and Privacy Policy accepted. A route redirect, deliberately,
  // not an RLS condition: consent here gates using the product, and Phase 1's portal holds nothing
  // but the account's own profile. docs/DECISIONS.md.
  const session = await requireVerifiedSession('/portal');
  const consent = await requireAcceptedPolicies(session, '/portal');

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, display_name, created_at')
    .eq('id', session.userId)
    .maybeSingle();

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">Portal</h1>
          <p className="truncate text-sm text-neutral-500">{session.email}</p>
        </div>
        <form action={logOutAction}>
          <button type="submit" className="text-sm underline underline-offset-2">
            Sign out
          </button>
        </form>
      </header>

      {notice ? (
        <p
          role="status"
          className="rounded border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-700"
        >
          {notice}
        </p>
      ) : null}

      <section className="rounded border border-dashed border-neutral-300 px-4 py-8 text-center">
        <p className="text-sm text-neutral-500">
          Nothing here yet. This is where the product will live.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Your profile</h2>

        <form action={updateDisplayName} className="flex gap-2">
          <label htmlFor="display_name" className="sr-only">
            Display name
          </label>
          <input
            id="display_name"
            name="display_name"
            type="text"
            maxLength={80}
            defaultValue={profile?.display_name ?? ''}
            placeholder="Display name"
            className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-sm text-white">
            Save
          </button>
        </form>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-neutral-500">
          <dt>Account created</dt>
          <dd>
            {profile?.created_at
              ? new Date(profile.created_at).toISOString().slice(0, 10)
              : 'unknown'}
          </dd>
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Policies you accepted</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-neutral-500">
          {ACCEPTED_DOCUMENTS.map((document) => {
            const policy = CURRENT_POLICIES[document];
            // Read back from the ledger, not assumed from having got past the gate.
            const row = consent.acceptances.find(
              (a) => a.document === document && a.version === policy.version,
            );
            return (
              <div key={document} className="contents">
                <dt>
                  <Link href={policy.path} className="underline underline-offset-2">
                    {policy.title}
                  </Link>
                </dt>
                <dd>
                  {row
                    ? `Version ${row.version}, accepted ${row.accepted_at.slice(0, 10)}`
                    : 'Not recorded'}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section className="flex flex-col gap-2 border-t border-neutral-200 pt-6">
        <h2 className="text-sm font-medium">Delete account</h2>
        <p className="text-xs text-neutral-500">
          Closes your account and signs you out everywhere.
        </p>
        <Link href="/account/delete" className="text-sm text-red-700 underline underline-offset-2">
          Delete my account
        </Link>
      </section>
    </main>
  );
}
