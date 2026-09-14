'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { currentSession } from '@/features/auth/session';
import { createClient } from '@/lib/supabase/server';

/**
 * Update the signed-in user's own display name.
 *
 * This exists because docs/ACCESS-CONTROL.md gives "own profile row" Read **and Update**,
 * and a permission nothing exercises is a permission nobody has tested. It is not a
 * product feature — Stage 5 says "the portal contains a placeholder. Do not invent
 * product features" — it is the minimum realisation of a row in the matrix.
 */
export async function updateDisplayName(formData: FormData): Promise<void> {
  const raw = String(formData.get('display_name') ?? '').trim();
  const displayName = raw.length === 0 ? null : raw;

  if (displayName !== null && displayName.length > 80) {
    redirect('/portal?outcome=name_too_long');
  }

  // Re-checked here, not trusted from the page that rendered the form. A Server Action is
  // an endpoint: anyone can POST to it, whatever the page did or did not show them.
  const session = await currentSession();
  if (session.state !== 'verified') {
    redirect('/login?next=/portal');
  }

  const supabase = await createClient();

  // No .eq('id', ...) is needed for safety — the RLS update policy restricts this to the
  // caller's own row. It is written explicitly anyway so the intent is readable, and so
  // that a policy regression shows up as zero rows rather than as someone else's row.
  //
  // `.select('id')` returns the rows actually updated, and the count is CHECKED below.
  // An UPDATE that matches nothing is not an error — Postgres and PostgREST both report
  // it as success (docs/DOMAIN.md). Without this check, a missing profile row or a broken
  // policy would tell the user "Saved." while saving nothing. That is P7 in a UI: a claim
  // that something worked, made without evidence that it did.
  const { data, error } = await supabase
    .from('profiles')
    .update({ display_name: displayName })
    .eq('id', session.userId)
    .select('id');

  if (error || !data || data.length !== 1) {
    redirect('/portal?outcome=save_failed');
  }

  revalidatePath('/portal');
  redirect('/portal?outcome=saved');
}
