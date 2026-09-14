/**
 * Next.js boot hook. Runs once per server process, before any request is handled.
 *
 * Two jobs:
 *   1. Start Sentry, before anything can throw.
 *   2. Assert the environment, so a missing variable fails at startup with a message naming
 *      it, rather than as a confusing error deep inside some later request.
 */

import * as Sentry from '@sentry/nextjs';
import type { Instrumentation } from 'next';

import { CORRELATION_HEADER, isCorrelationId } from '@/lib/request/correlation-header';

export async function register(): Promise<void> {
  // Only the Node.js server runtime has a full process.env to assert against. Proxy runs on
  // Node in Next 16 (docs/DOMAIN.md), so there is no edge runtime to configure.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  await import('./sentry.server.config');

  const { serverEnv } = await import('@/lib/env/server');
  serverEnv();
}

/**
 * Captures errors thrown in Server Components, Route Handlers, Server Actions and Proxy, and
 * sends them through the same scrubbing as everything else (src/lib/observability/sentry-options.ts).
 *
 * Two tags are added, both so that a failure someone REPORTS can be found:
 *   - digest:         the "Reference" src/app/error.tsx shows the user.
 *   - correlation_id: the id src/proxy.ts put on the request, which the structured events
 *                     for that request carry too (BUILD-PLAN.md Stage 9).
 * Request headers themselves are not sent (dataCollection), so this is the only way the id
 * reaches Sentry. It is re-validated: /api/version is outside the proxy, so there a client
 * could have supplied the header.
 *
 * Sentry's captureRequestError forks the current scope, so tags set here carry into it.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  Sentry.withScope((scope) => {
    if (typeof error === 'object' && error !== null && 'digest' in error) {
      scope.setTag('digest', String(error.digest));
    }

    const correlationId = request.headers[CORRELATION_HEADER];
    if (typeof correlationId === 'string' && isCorrelationId(correlationId)) {
      scope.setTag('correlation_id', correlationId);
    }

    Sentry.captureRequestError(error, request, context);
  });
};
