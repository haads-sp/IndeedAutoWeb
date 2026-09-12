import 'server-only';

/**
 * Rate limiting for authentication attempts.
 *
 * BUILD-PLAN.md Stage 4: "Rate limit login attempts here, not later (Upstash). Per-address
 * and per-IP." Both dimensions are needed and they stop different attacks:
 *
 *   - **Per-address** stops a password-guessing run against one known account, however
 *     many machines it comes from.
 *   - **Per-IP** stops credential stuffing, where one host tries one password against
 *     thousands of different addresses and never trips a per-address limit.
 *
 * Limiting only one of them leaves the other attack completely unhindered.
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

import { upstashConfig } from '@/lib/env/upstash';

export type RateLimitDecision =
  | { allowed: true; enforced: boolean }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Windows are deliberately generous enough not to catch a person who has genuinely
 * forgotten their password, and tight enough that automated guessing is pointless.
 *
 * Per-address is the stricter of the two: a real human rarely needs six tries, whereas one
 * office or one mobile carrier NAT can legitimately produce many sign-ins from one IP.
 */
const PER_ADDRESS = { attempts: 5, window: '15 m' } as const;
const PER_IP = { attempts: 20, window: '10 m' } as const;

let cached: { address: Ratelimit; ip: Ratelimit } | null | undefined;

function limiters() {
  if (cached !== undefined) return cached;

  const config = upstashConfig();
  if (!config) {
    cached = null;
    return cached;
  }

  const redis = new Redis({ url: config.url, token: config.token });

  cached = {
    address: new Ratelimit({
      redis,
      // Sliding window, not fixed: a fixed window lets an attacker burn the full quota at
      // the end of one window and again at the start of the next, doubling the real rate.
      limiter: Ratelimit.slidingWindow(PER_ADDRESS.attempts, PER_ADDRESS.window),
      prefix: 'rl:login:addr',
      analytics: false,
    }),
    ip: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(PER_IP.attempts, PER_IP.window),
      prefix: 'rl:login:ip',
      analytics: false,
    }),
  };

  return cached;
}

/**
 * @param emailKey a STABLE, normalised identifier for the address being attempted.
 * @param ip the client address, or null when it could not be determined.
 *
 * **Fails open.** If Upstash is unreachable the attempt is allowed and `enforced` is
 * false, so the caller can record that the limit did not actually run. An Upstash outage
 * must not lock every user out of their account; it is a control, not the security
 * boundary. `enforced: false` must never be read as "allowed because under the limit".
 */
export async function checkLoginRateLimit(
  emailKey: string,
  ip: string | null,
): Promise<RateLimitDecision> {
  const limits = limiters();
  if (!limits) return { allowed: true, enforced: false };

  try {
    // Both are checked, and both are consumed, even if the first one denies. Consuming
    // only up to the first denial would let an attacker probe which dimension they had
    // tripped, and would leave the other counter artificially low.
    const [addressResult, ipResult] = await Promise.all([
      limits.address.limit(emailKey),
      ip ? limits.ip.limit(ip) : Promise.resolve(null),
    ]);

    const denied = [addressResult, ipResult].filter((r) => r !== null && !r.success);

    if (denied.length > 0) {
      const soonestReset = Math.min(...denied.map((r) => r!.reset));
      const retryAfterSeconds = Math.max(1, Math.ceil((soonestReset - Date.now()) / 1000));
      return { allowed: false, retryAfterSeconds };
    }

    return { allowed: true, enforced: true };
  } catch {
    // Network error or Upstash outage. See the doc comment: fail open, flagged.
    return { allowed: true, enforced: false };
  }
}

/** True when rate limiting is actually wired up. Used to report configuration honestly. */
export function rateLimitConfigured(): boolean {
  return limiters() !== null;
}
