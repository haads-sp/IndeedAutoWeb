import 'server-only';

/**
 * Whether an account has accepted the current policies, and recording that it has.
 *
 * The ledger is public.policy_acceptances (supabase/migrations/20260915030000_policy_acceptance.sql).
 * Reads go through RLS as the signed-in user; the only write path is accept_policies(), which
 * enforces a live session, a verified address and an active account itself.
 */

import { createClient } from '@/lib/supabase/server';

import { ACCEPTED_DOCUMENTS, CURRENT_POLICIES, type AcceptedDocument, type Policy } from './policies';

export interface Acceptance {
  readonly document: string;
  readonly version: string;
  readonly accepted_at: string;
  readonly source: string;
}

/**
 * Pure. The current policies this account has NOT accepted, in a stable order.
 *
 * Only an exact version match counts. Accepting last year's Terms is not accepting this year's.
 */
export function outstandingPolicies(
  accepted: readonly Pick<Acceptance, 'document' | 'version'>[],
  current: Readonly<Record<AcceptedDocument, Policy>> = CURRENT_POLICIES,
): { document: AcceptedDocument; policy: Policy }[] {
  return ACCEPTED_DOCUMENTS.filter(
    (document) =>
      !accepted.some((row) => row.document === document && row.version === current[document].version),
  ).map((document) => ({ document, policy: current[document] }));
}

export type ConsentStatus =
  | { readonly status: 'accepted'; readonly acceptances: readonly Acceptance[] }
  | {
      readonly status: 'outstanding';
      readonly outstanding: ReturnType<typeof outstandingPolicies>;
      readonly acceptances: readonly Acceptance[];
    }
  /** The ledger could not be read. Never treated as "accepted", and never as "outstanding" either. */
  | { readonly status: 'unavailable' };

/**
 * Reads the signed-in account's acceptances.
 *
 * 'unavailable' is its own outcome, because both obvious defaults are wrong. Treating a failed
 * read as "accepted" lets someone past consent. Treating it as "outstanding" sends them to the
 * acceptance page, whose own read fails the same way, and back: a redirect loop. The caller
 * shows the error page instead.
 */
export async function consentStatus(userId: string): Promise<ConsentStatus> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('policy_acceptances')
      .select('document, version, accepted_at, source')
      .eq('user_id', userId)
      .order('accepted_at', { ascending: false });

    if (error || !data) return { status: 'unavailable' };

    const outstanding = outstandingPolicies(data);
    return outstanding.length === 0
      ? { status: 'accepted', acceptances: data }
      : { status: 'outstanding', outstanding, acceptances: data };
  } catch {
    return { status: 'unavailable' };
  }
}

export type AcceptOutcome =
  /** `recorded` is 0 when every current version was already accepted. */
  | { readonly outcome: 'accepted'; readonly recorded: number; readonly userId: string | null }
  /** The confirmation checkbox was not ticked. Nothing was sent to the database. */
  | { readonly outcome: 'not_confirmed' }
  /** The database refused: no live session, an unverified address, or a deleted account. */
  | { readonly outcome: 'not_permitted' }
  | { readonly outcome: 'unavailable' };

/** Postgres `insufficient_privilege`, which accept_policies() raises for every refusal. */
const INSUFFICIENT_PRIVILEGE = '42501';

export async function acceptCurrentPolicies(confirmed: boolean): Promise<AcceptOutcome> {
  if (!confirmed) return { outcome: 'not_confirmed' };

  try {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc('accept_policies', {
      p_terms_version: CURRENT_POLICIES.terms.version,
      p_privacy_version: CURRENT_POLICIES.privacy.version,
    });

    if (error) {
      return error.code === INSUFFICIENT_PRIVILEGE ? { outcome: 'not_permitted' } : { outcome: 'unavailable' };
    }

    // For the structured event only. The database has already decided whose rows these are.
    const { data: claimsData } = await supabase.auth.getClaims();

    return {
      outcome: 'accepted',
      recorded: typeof data === 'number' ? data : 0,
      userId: typeof claimsData?.claims?.sub === 'string' ? claimsData.claims.sub : null,
    };
  } catch {
    return { outcome: 'unavailable' };
  }
}
