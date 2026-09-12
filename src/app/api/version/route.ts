/**
 * Which commit is actually serving traffic, and whether login rate limiting is real.
 *
 * `curl -s https://www.alsayeed.ca/api/version` answers the question that went unanswered
 * for hours in ISSUES.md row 1: is the deployed revision the one I pushed?
 *
 * Deliberately unauthenticated. It exposes a commit SHA, a branch name, a build time and
 * a boolean-ish rate-limit state — none of which grants access to anything, and all of
 * which are useless without the private repository. Requiring auth would make it useless
 * for the one job it has: answering "what is live" from a terminal or an uptime check,
 * before you have a session and especially when auth itself is what is broken.
 */

import { NextResponse } from 'next/server';

import { rateLimitConfigured } from '@/features/auth/rate-limit';
import { deploymentInfo } from '@/lib/env/deployment';
import { upstashPartiallyConfigured } from '@/lib/env/upstash';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    {
      ...deploymentInfo(),
      /**
       * Whether login rate limiting is actually ENFORCED, not whether we intended it to
       * be. A limiter that silently allows everything because Upstash is unconfigured is
       * precisely the failure BUILD-PLAN.md §8 asks about — a rule nothing checks — and
       * it is invisible from the outside unless something reports it.
       *
       * 'misconfigured' means one of the two Upstash variables is set and the other is
       * not, which is a mistake rather than a decision.
       */
      rateLimit: rateLimitConfigured()
        ? 'enforced'
        : upstashPartiallyConfigured()
          ? 'misconfigured'
          : 'not-configured',
    },
    {
      headers: {
        // Never cached. A cached answer to "what is deployed" is worse than no answer.
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  );
}
