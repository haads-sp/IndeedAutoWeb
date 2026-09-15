import Link from 'next/link';

import type { Policy } from '@/features/legal/policies';

import { SITE_NAME } from './site';
import { SiteFooter } from './site-footer';

/**
 * The body of every policy page until a lawyer has written and reviewed the real text.
 *
 * BUILD-PLAN.md Stage 11: "do not write the legal text ... a clearly marked `TODO: requires review
 * by a lawyer` in each. Generated legal copy that reads professionally is worse than no copy,
 * because it stops me from getting real review."
 *
 * So this renders the marker, VISIBLY, and nothing that could be mistaken for the policy. The
 * notes for whoever writes the text are code comments in each page file, not page content.
 * tests/e2e/public.spec.ts fails if a policy page loses the marker, so replacing this component
 * with real text is a deliberate act (bump the version too: src/features/legal/policies.ts).
 */
export function PolicyPlaceholder({ policy }: { policy: Policy }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-8">
      <Link href="/" className="text-sm text-neutral-500 underline underline-offset-2">
        {SITE_NAME}
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{policy.title}</h1>
        <p className="text-xs text-neutral-500">Version {policy.version}</p>
      </header>

      <section
        role="note"
        aria-label="Placeholder notice"
        className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        <p className="font-semibold">TODO: requires review by a lawyer</p>
        <p>
          This page is a placeholder. The {policy.title} for this site has not been written or
          reviewed yet.
        </p>
      </section>

      <SiteFooter />
    </main>
  );
}
