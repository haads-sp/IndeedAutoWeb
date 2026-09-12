/**
 * Which commit is actually serving traffic.
 *
 * `curl -s https://www.alsayeed.ca/api/version` answers the question that went unanswered
 * for hours in ISSUES.md row 1: is the deployed revision the one I pushed?
 *
 * Deliberately unauthenticated. It exposes a commit SHA, a branch name and a build time —
 * none of which grants access to anything, and all of which are useless without the
 * private repository. Requiring auth would make it useless for the one job it has, which
 * is answering "what is live" from a terminal or an uptime check before you have a session.
 */

import { NextResponse } from 'next/server';

import { deploymentInfo } from '@/lib/env/deployment';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(deploymentInfo(), {
    headers: {
      // Never cached. A cached answer to "what is deployed" is worse than no answer.
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
