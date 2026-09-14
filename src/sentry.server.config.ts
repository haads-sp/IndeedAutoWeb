/**
 * Sentry, server runtime only.
 *
 * There is deliberately NO browser Sentry (no instrumentation-client.ts). This application
 * has no client-side code of its own — every action is a Server Action — so errors are
 * captured with full detail on the server. A browser SDK would add JavaScript to every page,
 * need a looser Content-Security-Policy, and is where URL tokens and cookies most easily
 * leak. See docs/DECISIONS.md.
 *
 * No DSN means no Sentry: CI, the E2E suite and local development run without it, and
 * /api/version reports the state honestly rather than pretending.
 */

import * as Sentry from '@sentry/nextjs';

import { deploymentInfo } from '@/lib/env/deployment';
import { sentryDsn } from '@/lib/env/sentry';
import { sentryServerOptions } from '@/lib/observability/sentry-options';

const dsn = sentryDsn();

if (dsn) {
  const deployment = deploymentInfo();
  Sentry.init(
    sentryServerOptions({
      dsn,
      environment: deployment.environment ?? 'development',
      release: deployment.commit ?? undefined,
    }) as Parameters<typeof Sentry.init>[0],
  );
}
