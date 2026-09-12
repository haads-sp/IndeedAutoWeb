/**
 * The absolute origin of this deployment.
 *
 * Lives in `src/lib/env/` because it reads `process.env`, and that is the one place
 * allowed to (docs/ARCHITECTURE.md). Putting it in a `lib/site-url.ts` would have been
 * tidier to import and would have broken the rule on its first real test.
 *
 * Needed because email confirmation links are absolute. A relative redirect is fine
 * inside the app; a link in an inbox has to name the host.
 */

import { clientEnv } from './client';

/** Fallback for local development, matching the port used in docs and scripts. */
const LOCAL_ORIGIN = 'http://localhost:3111';

/**
 * Resolution order, most explicit first:
 *
 * 1. `NEXT_PUBLIC_SITE_URL` — set by us, per environment. Production must have it.
 * 2. `VERCEL_URL` — injected by Vercel on preview deployments, whose hostname is
 *    generated per deployment and therefore cannot be configured ahead of time. It
 *    arrives without a scheme.
 * 3. localhost.
 */
export function siteUrl(): string {
  const configured = clientEnv.NEXT_PUBLIC_SITE_URL;
  if (configured) return stripTrailingSlash(configured);

  const vercelHost = process.env.VERCEL_URL;
  if (vercelHost) return `https://${stripTrailingSlash(vercelHost)}`;

  return LOCAL_ORIGIN;
}

/** Builds an absolute URL against the site origin. */
export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
