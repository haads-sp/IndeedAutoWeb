/**
 * The published policies, and which version of each is current.
 *
 * BUILD-PLAN.md Stage 11: the policies are routed PLACEHOLDER pages, and their text must not be
 * generated ("Generated legal copy that reads professionally is worse than no copy"). So every
 * version below ends in `-placeholder`, and the acceptance ledger records exactly that. An account
 * that accepted a placeholder has not accepted the reviewed text.
 *
 * THE VERSION RULE. Change a document's text, change its version, in the same commit. A new
 * version sends every account back through /accept-terms before the portal, because nobody has
 * accepted it yet. That is the mechanism, not a side effect: docs/EXTENDING.md has the recipe.
 *
 * Pure, with no server-only import, because the signup page, the policy pages and llms.txt all
 * read it.
 */

/** Documents a person must accept. Must match the CHECK constraint on public.policy_acceptances. */
export const ACCEPTED_DOCUMENTS = ['terms', 'privacy'] as const;
export type AcceptedDocument = (typeof ACCEPTED_DOCUMENTS)[number];

export interface Policy {
  readonly title: string;
  readonly path: string;
  /** Recorded in the ledger. Must match `^[A-Za-z0-9._-]{1,64}$` (the table's CHECK constraint). */
  readonly version: string;
}

export const CURRENT_POLICIES: Readonly<Record<AcceptedDocument, Policy>> = {
  terms: { title: 'Terms of Service', path: '/terms', version: '2026-09-15-placeholder' },
  privacy: { title: 'Privacy Policy', path: '/privacy', version: '2026-09-15-placeholder' },
};

/**
 * Published, but not something a person accepts: it describes what happens when an account is
 * deleted. Linked from the deletion page and the footer.
 */
export const DATA_DELETION_POLICY: Policy = {
  title: 'Data Deletion Policy',
  path: '/data-deletion',
  version: '2026-09-15-placeholder',
};

/**
 * The user metadata a signup sends. The database trigger record_signup_policy_acceptance() reads
 * exactly this shape, so it lives beside the versions it carries.
 */
export function signupAcceptanceMetadata(): { accepted_policies: Record<AcceptedDocument, string> } {
  return {
    accepted_policies: {
      terms: CURRENT_POLICIES.terms.version,
      privacy: CURRENT_POLICIES.privacy.version,
    },
  };
}
