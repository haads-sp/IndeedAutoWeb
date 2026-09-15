/**
 * Privacy Policy. A routed placeholder: BUILD-PLAN.md Stage 11.
 *
 * TODO: requires review by a lawyer. The text is deliberately NOT written here.
 *
 * Notes for whoever writes it: an inventory of what the system actually stores and where, as of
 * Stage 11. Facts, not proposed wording. Re-check it against the code before relying on it.
 *
 * Supabase (authentication and the Postgres database):
 * - Email address; password, stored hashed by Supabase Auth; when the address was confirmed.
 * - Sessions, with the IP address and user agent the Auth server saw (auth.sessions).
 * - profiles: an optional display name, created and updated times, and deleted_at.
 * - audit_log: account events (created, email confirmed, password changed, session started and
 *   ended, soft-deleted, restored, purged), with IP address and user agent on session events and
 *   on a self-deletion.
 * - policy_acceptances: which version of the Terms and this policy was accepted, and when.
 *
 * Other processors:
 * - Vercel hosts the application. Its request logs, and this app's structured log lines, include
 *   the IP address. Platform retention applies.
 * - Upstash Redis holds rate-limit counters keyed on the email address as typed, and on the IP
 *   address. They expire with their sliding window (10 to 15 minutes).
 * - Sentry receives server errors and structured log events, scrubbed of email addresses, tokens,
 *   cookies, request headers and IP addresses (src/lib/observability/sentry-options.ts). Events can
 *   carry the account's user id. "Prevent Storing of IP Addresses" is enabled on the project.
 * - Resend delivers the confirmation and password-reset emails, through Supabase's SMTP settings.
 * - Have I Been Pwned: at signup and password change, the first five characters of the password's
 *   SHA-1 hash are sent, never the password or its full hash (src/features/auth/breached-password.ts).
 * - Cloudflare provides DNS only. No traffic passes through it.
 *
 * Cookies: HttpOnly session cookies set by Supabase Auth, needed to stay signed in. No analytics,
 * advertising or tracking scripts, and no client-side error reporting.
 *
 * Changing this text means bumping CURRENT_POLICIES.privacy.version in
 * src/features/legal/policies.ts, which asks every account to accept again before the portal.
 */

import type { Metadata } from 'next';

import { CURRENT_POLICIES } from '@/features/legal/policies';

import { PolicyPlaceholder } from '../policy-placeholder';

export const metadata: Metadata = { title: CURRENT_POLICIES.privacy.title };

export default function PrivacyPage() {
  return <PolicyPlaceholder policy={CURRENT_POLICIES.privacy} />;
}
