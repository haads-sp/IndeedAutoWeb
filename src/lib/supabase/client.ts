/**
 * Browser Supabase client.
 *
 * Uses the PUBLISHABLE key, which is safe in the browser precisely because Row Level
 * Security still gates every query made with it. The publishable key identifies the
 * project; it does not grant access. Access is granted by policies, evaluated against the
 * signed-in user's JWT (docs/ACCESS-CONTROL.md).
 *
 * The secret key must never appear in this file or anything it imports.
 */

import { createBrowserClient } from '@supabase/ssr';

import { supabasePublicConfig } from './config';

/**
 * Creates a browser client. `createBrowserClient` memoises internally, so calling this
 * per component is fine and is the documented usage.
 */
export function createClient() {
  const { url, publishableKey } = supabasePublicConfig();
  return createBrowserClient(url, publishableKey);
}
