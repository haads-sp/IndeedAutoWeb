import Link from 'next/link';

import { CURRENT_POLICIES, DATA_DELETION_POLICY } from '@/features/legal/policies';

/** Links to every published policy. On the landing page and each policy page. */
export function SiteFooter() {
  const links = [CURRENT_POLICIES.terms, CURRENT_POLICIES.privacy, DATA_DELETION_POLICY];

  return (
    <footer className="border-t border-neutral-200 pt-4">
      <nav aria-label="Policies" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
        {links.map((policy) => (
          <Link key={policy.path} href={policy.path} className="underline underline-offset-2">
            {policy.title}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
