/**
 * Data Deletion Policy. A routed placeholder: BUILD-PLAN.md Stage 11.
 *
 * TODO: requires review by a lawyer. The text is deliberately NOT written here.
 *
 * BEFORE REAL USERS EXIST, this policy must describe the purge accurately, or the purge must be
 * scheduled. docs/DECISIONS.md, "Deletion grace period: 30 days, purged manually". That entry
 * exists because a promise nothing enforces is a rule nothing checks, aimed at users.
 *
 * Notes for whoever writes it. Facts about the system as of Stage 11, not proposed wording:
 *
 * - /account/delete requires the current password (a password sign-in within the last five
 *   minutes, enforced in the database) and an explicit confirmation.
 * - Deletion is soft: profiles.deleted_at is set, every session is signed out, and the account is
 *   refused from then on. An administrator can reverse it with admin_restore_account().
 * - Grace period: at least 30 days. admin_purge_deleted_accounts() then deletes the auth user
 *   (email address, password hash) and, by cascade, the profile. It is RUN BY HAND. Nothing
 *   schedules it, so there is no upper bound today.
 * - What remains after a purge: audit_log rows (the user id, plus IP address and user agent on
 *   session events and on the self-deletion) and policy_acceptances rows (the user id, versions and
 *   times). Neither table has a foreign key, by design, so both outlive the account. Whether that
 *   retention is right is a question for review.
 * - Outside the database: Vercel logs, Sentry events and Resend delivery records follow each
 *   vendor's retention. Upstash rate-limit counters expire within minutes.
 * - There is no support contact today, so the policy must not promise one.
 */

import type { Metadata } from 'next';

import { DATA_DELETION_POLICY } from '@/features/legal/policies';

import { PolicyPlaceholder } from '../policy-placeholder';

export const metadata: Metadata = { title: DATA_DELETION_POLICY.title };

export default function DataDeletionPage() {
  return <PolicyPlaceholder policy={DATA_DELETION_POLICY} />;
}
