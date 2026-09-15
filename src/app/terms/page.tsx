/**
 * Terms of Service. A routed placeholder: BUILD-PLAN.md Stage 11.
 *
 * TODO: requires review by a lawyer. The text is deliberately NOT written here.
 *
 * Notes for whoever writes it. These are facts about the system, not proposed wording:
 *
 * - What exists today: an account (email address and password), email confirmation, and a portal
 *   reachable only by a confirmed, signed-in account. The portal has no product in it yet.
 * - What is planned (README.md, "Phase 2"): a tool that applies to jobs on a third-party job site
 *   on the account holder's behalf, using a model API. That site's own terms restrict automated
 *   applications. The Terms, and the product, need a position on that before Phase 2 ships.
 * - Acceptance is recorded per version in public.policy_acceptances, at signup or on
 *   /accept-terms. Changing this text means bumping CURRENT_POLICIES.terms.version in
 *   src/features/legal/policies.ts, which asks every account to accept again before the portal.
 * - Account deletion is described by the Data Deletion Policy (src/app/data-deletion/page.tsx).
 */

import type { Metadata } from 'next';

import { CURRENT_POLICIES } from '@/features/legal/policies';

import { PolicyPlaceholder } from '../policy-placeholder';

export const metadata: Metadata = { title: CURRENT_POLICIES.terms.title };

export default function TermsPage() {
  return <PolicyPlaceholder policy={CURRENT_POLICIES.terms} />;
}
