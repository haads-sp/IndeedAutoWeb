'use server';

/**
 * STUB (Stage 4): sign-in and sign-out are rebuilt properly in Stage 4, with rate
 * limiting, correct cookie flags, and session refresh via proxy.ts. What is here exists
 * only so the Stage 2 walking skeleton can authenticate as a real user. Delete this file
 * in the same commit as its replacement (prohibition P8).
 *
 * Server Actions, not client-side calls, because an action can write cookies. The session
 * cookie is therefore set by the server on a normal form POST, with no client JavaScript
 * involved in the auth path at all.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

/**
 * Failure reasons, as an enum rather than free text.
 *
 * BUILD-PLAN.md §9 asks for this from Stage 9 on: "Any operation with more than two
 * outcomes gets an outcome enum, and those exact names are used in logs, in Sentry
 * grouping, and in user-facing copy." Starting it here costs nothing and means the
 * vocabulary does not have to be retrofitted later.
 *
 * These names are deliberately coarse. `invalid_credentials` covers both "no such user"
 * and "wrong password" because telling them apart for the caller is an account-enumeration
 * oracle — the specific vulnerability BUILD-PLAN.md Stage 3 calls out.
 */
export type PingOutcome =
  | 'invalid_credentials'
  | 'missing_fields'
  | 'message_invalid'
  | 'not_signed_in'
  | 'write_failed';

export async function signIn(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    redirect('/ping?outcome=missing_fields');
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // The real reason goes nowhere near the user (prohibition P3). From Stage 9 it goes
    // to a structured log and to Sentry; for now it is simply dropped.
    redirect('/ping?outcome=invalid_credentials');
  }

  revalidatePath('/ping');
  redirect('/ping');
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();

  revalidatePath('/ping');
  redirect('/ping');
}

export async function addPing(formData: FormData): Promise<void> {
  const message = String(formData.get('message') ?? '').trim();

  if (message.length < 1 || message.length > 280) {
    redirect('/ping?outcome=message_invalid');
  }

  const supabase = await createClient();

  // getClaims(), never getSession() — the JWT signature is verified here. See
  // docs/DOMAIN.md and BUILD-PLAN.md §4.3.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (!userId) {
    redirect('/ping?outcome=not_signed_in');
  }

  // user_id is set from the VERIFIED claim, never from the form. The RLS insert policy
  // (with check auth.uid() = user_id) would reject a mismatch anyway — belt and braces,
  // and Stage 6 proves the braces hold.
  const { error } = await supabase.from('ping').insert({ user_id: userId, message });

  if (error) {
    redirect('/ping?outcome=write_failed');
  }

  revalidatePath('/ping');
  redirect('/ping');
}
