/**
 * Upstash Redis credentials.
 *
 * In `src/lib/env/` because it reads `process.env`, which nothing else may do.
 *
 * Returns null rather than throwing when unconfigured. Rate limiting is a control that
 * must degrade rather than break: a deployment without Upstash should still let people
 * sign in. The caller is responsible for making that degradation visible — see
 * `src/features/auth/rate-limit.ts`.
 */

import 'server-only';

export interface UpstashConfig {
  readonly url: string;
  readonly token: string;
}

export function upstashConfig(): UpstashConfig | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  // Both or neither. One without the other is a misconfiguration rather than a choice,
  // and silently treating it as "disabled" would hide it.
  if (!url || !token) return null;

  return { url, token };
}

/** True when only one of the pair is set — a misconfiguration worth surfacing. */
export function upstashPartiallyConfigured(): boolean {
  const url = Boolean(process.env.UPSTASH_REDIS_REST_URL);
  const token = Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);
  return url !== token;
}
