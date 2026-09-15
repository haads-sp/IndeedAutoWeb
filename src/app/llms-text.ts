import { CURRENT_POLICIES, DATA_DELETION_POLICY, type Policy } from '@/features/legal/policies';

import { SITE_DESCRIPTION, SITE_NAME } from './site';

/**
 * llms.txt: a plain-text description of the site and its important pages, for language models.
 * BUILD-PLAN.md Stage 11. Format per https://llmstxt.org: a title, a one-line summary, then
 * sections of links.
 *
 * Says only what exists (accounts), by the same decision as the landing page (./site.ts). The
 * policies are described as what they are today: placeholders.
 *
 * Pure: `url` turns a path into an absolute URL for the deployment being described.
 */
export function llmsText(url: (path: string) => string): string {
  const policy = (p: Policy) =>
    `- [${p.title}](${url(p.path)}): Placeholder, pending review by a lawyer. Version ${p.version}.`;

  return [
    `# ${SITE_NAME}`,
    '',
    `> ${SITE_DESCRIPTION}`,
    '',
    'Accounts are created with an email address and a password. The address is confirmed from an',
    'email before the account can be used. A private portal is available only to signed-in accounts',
    'with a confirmed address.',
    '',
    '## Pages',
    '',
    `- [Home](${url('/')}): Create an account, or sign in.`,
    `- [Create an account](${url('/signup')}): Email address and password; a confirmation email follows.`,
    `- [Sign in](${url('/login')}): For existing accounts.`,
    `- [Reset a password](${url('/forgot-password')}): Sends a reset link to the account's email address.`,
    '',
    '## Policies',
    '',
    policy(CURRENT_POLICIES.terms),
    policy(CURRENT_POLICIES.privacy),
    policy(DATA_DELETION_POLICY),
    '',
  ].join('\n');
}
