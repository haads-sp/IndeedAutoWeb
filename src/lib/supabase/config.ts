/**
 * The two public Supabase values, in one place, asserted once.
 *
 * This module is imported by BOTH the browser client and the server client, so it must
 * stay free of anything server-only. It reads through `clientEnv`, which is the literal
 * `process.env.NEXT_PUBLIC_*` access Next inlines at build time.
 *
 * The secret key is deliberately absent. Nothing in Stage 2 needs `BYPASSRLS`, and a
 * module that both sides import is the last place it should ever appear.
 */

import { clientEnv } from '@/lib/env/client';

export interface SupabasePublicConfig {
  readonly url: string;
  readonly publishableKey: string;
}

/**
 * @throws if either variable is missing, naming both if both are absent.
 *
 * These are asserted here rather than trusted because the failure they prevent is ugly:
 * `createBrowserClient(undefined, undefined)` fails deep inside the library with a
 * message that says nothing about environment variables.
 */
export function supabasePublicConfig(): SupabasePublicConfig {
  const url = clientEnv.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    // Both names are collected before throwing, so a deployment missing both is told
    // about both. Same promise the env assertion makes in src/lib/env/registry.ts.
    const missing = [
      url ? null : 'NEXT_PUBLIC_SUPABASE_URL',
      publishableKey ? null : 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    ].filter((name): name is string => name !== null);

    throw new Error(
      `Supabase is not configured. Missing: ${missing.join(', ')}. ` +
        'Copy .env.example to .env.local and fill these in, or set them in the deployment environment.',
    );
  }

  return { url, publishableKey };
}
