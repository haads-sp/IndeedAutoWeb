/**
 * The single declaration of every environment variable this app reads.
 *
 * `src/lib/env/` is the ONLY place allowed to touch `process.env`. Everything else
 * imports `serverEnv()` or `clientEnv` from here.
 *
 * `requiredFrom` is the stage at which a variable becomes mandatory. Stage 1's required
 * set is deliberately EMPTY: the assertion mechanism ships now and entries are switched
 * on as each stage lands. Declaring variables required before anything provisions them
 * would just fail every build for no signal.
 */

export type Scope = 'server' | 'client';

/** The stage a variable becomes required, or `null` while nothing needs it yet. */
export type RequiredFrom = number | null;

export interface EnvVar {
  readonly name: string;
  readonly scope: Scope;
  readonly requiredFrom: RequiredFrom;
  readonly description: string;
}

export const ENV_REGISTRY: readonly EnvVar[] = [
  {
    name: 'NEXT_PUBLIC_SUPABASE_URL',
    scope: 'client',
    requiredFrom: 2,
    description: 'Supabase project URL.',
  },
  {
    name: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    scope: 'client',
    requiredFrom: 2,
    description: 'Supabase publishable key; RLS still gates every query.',
  },
  {
    name: 'SUPABASE_SECRET_KEY',
    scope: 'server',
    requiredFrom: null,
    description: 'Supabase secret key. Carries BYPASSRLS. Server only.',
  },
  {
    name: 'NEXT_PUBLIC_SITE_URL',
    scope: 'client',
    requiredFrom: 3,
    description: 'Absolute origin of this deployment.',
  },
  {
    name: 'UPSTASH_REDIS_REST_URL',
    scope: 'server',
    requiredFrom: null,
    description: 'Upstash Redis REST endpoint, for rate limiting.',
  },
  {
    name: 'UPSTASH_REDIS_REST_TOKEN',
    scope: 'server',
    requiredFrom: null,
    description: 'Upstash Redis REST token.',
  },
  {
    // Server scope, not NEXT_PUBLIC_: there is no browser Sentry to read it (docs/DECISIONS.md),
    // and a DSN published in page source lets anyone send junk events against the quota.
    // Never required: CI, E2E and local development run without Sentry, and /api/version
    // reports whether it is configured rather than failing boot.
    name: 'SENTRY_DSN',
    scope: 'server',
    requiredFrom: null,
    description: 'Sentry DSN. Ingest-only, but kept server-side: nothing in the browser reads it.',
  },
  {
    name: 'SENTRY_AUTH_TOKEN',
    scope: 'server',
    requiredFrom: null,
    description: 'Sentry auth token, for source map upload at build time.',
  },
  {
    name: 'SENTRY_ORG',
    scope: 'server',
    requiredFrom: null,
    description: 'Sentry organisation slug, for source map upload at build time.',
  },
  {
    name: 'SENTRY_PROJECT',
    scope: 'server',
    requiredFrom: null,
    description: 'Sentry project slug, for source map upload at build time.',
  },
];

/** The stage this checkout currently implements. Bumped as each stage lands. */
export const CURRENT_STAGE = 10;

/** Variables in `scope` that must be present at `stage`. */
export function requiredVars(scope: Scope, stage: number = CURRENT_STAGE): readonly EnvVar[] {
  return ENV_REGISTRY.filter(
    (v) => v.scope === scope && v.requiredFrom !== null && v.requiredFrom <= stage,
  );
}

/** Names in `names` that are absent or empty in `env`. Empty string counts as missing. */
export function findMissing(
  names: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  return names.filter((name) => {
    const value = env[name];
    return value === undefined || value === '';
  });
}

/**
 * Throws naming EVERY missing variable, not just the first. A first-missing-wins check
 * turns a misconfigured deployment into a game of whack-a-mole.
 */
export function assertPresent(
  scope: Scope,
  names: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): void {
  const missing = findMissing(names, env);
  if (missing.length > 0) {
    throw new Error(missingVarsMessage(scope, missing));
  }
}

/**
 * Builds the error message for a set of missing variables. Shared by both sides so the
 * wording — and the promise that EVERY missing name is listed — cannot drift apart.
 */
export function missingVarsMessage(scope: Scope, missing: readonly string[]): string {
  const plural = missing.length === 1 ? 'variable' : 'variables';
  return [
    `Missing required ${scope} environment ${plural}: ${missing.join(', ')}.`,
    `Add ${missing.length === 1 ? 'it' : 'them'} to .env.local (see .env.example),`,
    'or to the environment of the deployment you are starting.',
  ].join(' ');
}
