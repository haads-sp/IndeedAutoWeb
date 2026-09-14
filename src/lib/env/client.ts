/**
 * Browser-safe environment access.
 *
 * Every value here is `NEXT_PUBLIC_*` and therefore inlined into the client bundle at
 * build time. Nothing secret may ever be added to this file.
 *
 * Each variable is read by a LITERAL `process.env.NEXT_PUBLIC_X` expression. Next
 * substitutes these at build time by matching the literal text; a dynamic lookup such as
 * `process.env[name]` is not substituted and silently yields `undefined` in the browser.
 * That is why this reads as a repetitive object literal rather than a loop over the
 * registry — the repetition is load-bearing.
 */

import { assertPresent, requiredVars } from './registry';

export const clientEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
} as const;

export type ClientEnv = typeof clientEnv;

/**
 * Throws naming every missing client variable at once. Returns the same object so a
 * caller can assert and read in one expression.
 */
export function assertClientEnv(env: Readonly<Record<string, string | undefined>> = clientEnv): ClientEnv {
  assertPresent(
    'client',
    requiredVars('client').map((v) => v.name),
    env,
  );

  return clientEnv;
}
