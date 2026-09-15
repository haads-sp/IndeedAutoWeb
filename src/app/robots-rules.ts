import type { MetadataRoute } from 'next';

/**
 * robots.txt, as a pure function of the deployment environment. BUILD-PLAN.md Stage 11.
 *
 * A REQUEST to well-behaved crawlers, never access control (P2): every private path below refuses
 * a visitor on its own, whatever this file says. Listing them reveals nothing the pages themselves
 * do not.
 */

/**
 * Signed-in pages, links that carry single-use tokens, and the API. `/auth/` matters most: its
 * URLs contain token hashes, and an indexed copy of one is a leaked link.
 */
export const PRIVATE_PATHS = [
  '/portal',
  '/account/',
  '/accept-terms',
  '/auth/',
  '/reset-password',
  '/verify-email',
  '/api/',
] as const;

export function robotsRules(environment: string | null): MetadataRoute.Robots {
  // Only production is meant to be found. Preview deployments run against the preview database,
  // and a local or CI build has no business in a search index either.
  if (environment !== 'production') {
    return { rules: { userAgent: '*', disallow: '/' } };
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [...PRIVATE_PATHS],
    },
  };
}
