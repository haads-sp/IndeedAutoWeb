'use server';

/**
 * STUB (Stage 5): writes a row to the throwaway `ping` table. Goes with its page.
 *
 * What used to sit beside this — signIn and signOut — was deleted in Stage 4 when /login
 * replaced it, per prohibition P8.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

export async function addPing(formData: FormData): Promise<void> {
  const message = String(formData.get('message') ?? '').trim();

  if (message.length < 1 || message.length > 280) {
    redirect('/ping?outcome=message_invalid');
  }

  const supabase = await createClient();

  // getClaims(), never getSession(). BUILD-PLAN.md §4.3.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (!userId) {
    redirect('/login?next=/ping');
  }

  // user_id comes from the VERIFIED claim, never from the form. The RLS insert policy
  // would reject a mismatch anyway; Stage 6 proves that.
  const { error } = await supabase.from('ping').insert({ user_id: userId, message });

  if (error) {
    redirect('/ping?outcome=write_failed');
  }

  revalidatePath('/ping');
  redirect('/ping');
}
