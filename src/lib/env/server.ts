/**
 * Server-only environment access.
 *
 * `server-only` makes this module a build error if it is ever reachable from a
 * `'use client'` file. That import is the enforcer for the second half of the boundary
 * rule in docs/ARCHITECTURE.md, and is the reason server and client env are two files
 * rather than one: a single module asserting SUPABASE_SECRET_KEY would either break the
 * client build or teach someone to make the variable public.
 */

import 'server-only';

import { assertPresent, requiredVars } from './registry';

export interface ServerEnv {
  readonly SUPABASE_SECRET_KEY: string | undefined;
  readonly UPSTASH_REDIS_REST_URL: string | undefined;
  readonly UPSTASH_REDIS_REST_TOKEN: string | undefined;
  readonly SENTRY_DSN: string | undefined;
  readonly SENTRY_AUTH_TOKEN: string | undefined;
  readonly SENTRY_ORG: string | undefined;
  readonly SENTRY_PROJECT: string | undefined;
  readonly NEXT_PUBLIC_SUPABASE_URL: string | undefined;
  readonly NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string | undefined;
  readonly NEXT_PUBLIC_SITE_URL: string | undefined;
}

let cached: ServerEnv | undefined;

/**
 * Reads and validates the server environment. Collects ALL missing variables and throws
 * once naming every one of them — a first-missing-wins check turns a misconfigured
 * deployment into a game of whack-a-mole.
 *
 * Memoised: called on every boot via src/instrumentation.ts, and freely thereafter.
 */
export function serverEnv(): ServerEnv {
  if (cached !== undefined) return cached;

  assertPresent(
    'server',
    requiredVars('server').map((v) => v.name),
    process.env,
  );

  // Client-scoped variables are asserted HERE too, not only on the client. On the server
  // `process.env` holds every NEXT_PUBLIC_ value, so boot is the earliest and cheapest
  // place to catch a missing one — and the only place that catches it before a user does.
  // Without this, a required NEXT_PUBLIC_ variable was declared required and then checked
  // by nothing, which is the exact failure BUILD-PLAN.md §8 asks about: "Did I write a
  // rule in a document that nothing checks?"
  assertPresent(
    'client',
    requiredVars('client').map((v) => v.name),
    process.env,
  );

  cached = {
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    SENTRY_DSN: process.env.SENTRY_DSN,
    SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
    SENTRY_ORG: process.env.SENTRY_ORG,
    SENTRY_PROJECT: process.env.SENTRY_PROJECT,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  };

  return cached;
}

/** Test seam: drops the memoised value so a test can vary process.env. */
export function resetServerEnvCache(): void {
  cached = undefined;
}
