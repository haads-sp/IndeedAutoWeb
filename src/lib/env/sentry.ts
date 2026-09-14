/**
 * Sentry's runtime setting.
 *
 * In `src/lib/env/` because it reads `process.env`, which nothing else may do.
 *
 * Returns null rather than throwing when unset. Error reporting must degrade rather than
 * break: CI, the E2E suite and local development run without Sentry. The absence is made
 * visible by /api/version (`errorReporting`), not hidden.
 *
 * The build-time Sentry variables (SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT) are read by
 * next.config.ts, which runs before the application exists and cannot import this module.
 */

import 'server-only';

export function sentryDsn(): string | null {
  return process.env.SENTRY_DSN || null;
}
