import 'server-only';

/**
 * Rate limiting for authentication endpoints.
 *
 * Every policy limits per-address AND per-IP, because they stop different attacks:
 *
 *   - **Per-address** stops a sustained attack on one known account from many machines
 *     — password guessing on login, or email-bombing one person with reset links.
 *   - **Per-IP** stops one host spraying thousands of different addresses, which never
 *     trips a per-address limit.
 *
 * Limiting only one of them leaves the other attack completely unhindered.
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

import { upstashConfig } from '@/lib/env/upstash';

export type RateLimitDecision =
  | { allowed: true; enforced: boolean }
  | { allowed: false; retryAfterSeconds: number };

type Duration = `${number} ${'s' | 'm' | 'h'}`;

interface PolicyShape {
  readonly perAddress: { readonly attempts: number; readonly window: Duration };
  readonly perIp: { readonly attempts: number; readonly window: Duration };
}

/**
 * Per-address is the stricter dimension in both: a real person rarely needs many tries,
 * whereas one office or one mobile carrier NAT can legitimately share an IP.
 */
const POLICIES = {
  login: {
    perAddress: { attempts: 5, window: '15 m' },
    perIp: { attempts: 20, window: '10 m' },
  },
  /**
   * Stricter per address than login. Every allowed request sends a real email to a real
   * person, so the thing being protected is someone's inbox, not just our endpoint.
   */
  passwordReset: {
    perAddress: { attempts: 3, window: '15 m' },
    perIp: { attempts: 10, window: '10 m' },
  },
} as const satisfies Record<string, PolicyShape>;

export type RateLimitPolicy = keyof typeof POLICIES;

type Limiters = { address: Ratelimit; ip: Ratelimit };

let redis: Redis | null | undefined;
const limiterCache = new Map<RateLimitPolicy, Limiters>();

function redisClient(): Redis | null {
  if (redis !== undefined) return redis;
  const config = upstashConfig();
  redis = config ? new Redis({ url: config.url, token: config.token }) : null;
  return redis;
}

function limitersFor(policy: RateLimitPolicy): Limiters | null {
  const cached = limiterCache.get(policy);
  if (cached) return cached;

  const client = redisClient();
  if (!client) return null;

  const shape = POLICIES[policy];
  const limiters: Limiters = {
    address: new Ratelimit({
      redis: client,
      // Sliding, not fixed: a fixed window lets an attacker spend a full quota at the end
      // of one window and again at the start of the next, doubling the real rate.
      limiter: Ratelimit.slidingWindow(shape.perAddress.attempts, shape.perAddress.window),
      // Separate prefix per policy, so tripping the login limit does not block a
      // legitimate password reset for the same address, and vice versa.
      prefix: `rl:${policy}:addr`,
      analytics: false,
    }),
    ip: new Ratelimit({
      redis: client,
      limiter: Ratelimit.slidingWindow(shape.perIp.attempts, shape.perIp.window),
      prefix: `rl:${policy}:ip`,
      analytics: false,
    }),
  };

  limiterCache.set(policy, limiters);
  return limiters;
}

/**
 * @param emailKey a STABLE, normalised identifier for the address being attempted — keyed
 *   on the address given, whether or not an account exists for it. That is what keeps the
 *   limit itself from becoming an enumeration oracle.
 * @param ip the client address, or null when it could not be determined.
 *
 * **Fails open.** If Upstash is unreachable the attempt is allowed and `enforced` is false.
 * An Upstash outage must not lock everyone out; it is a control, not the security
 * boundary. `enforced: false` must never be read as "allowed because under the limit".
 */
export async function checkRateLimit(
  policy: RateLimitPolicy,
  emailKey: string,
  ip: string | null,
): Promise<RateLimitDecision> {
  const limits = limitersFor(policy);
  if (!limits) return { allowed: true, enforced: false };

  try {
    // Both counters are consumed even when the first denies. Stopping at the first denial
    // would let an attacker learn which dimension they had tripped, and would leave the
    // other counter artificially low.
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
    return { allowed: true, enforced: false };
  }
}

/** Login's limit. Kept as a named function so call sites read as what they are. */
export function checkLoginRateLimit(emailKey: string, ip: string | null) {
  return checkRateLimit('login', emailKey, ip);
}

/** True when rate limiting is actually wired up. Reported by /api/version. */
export function rateLimitConfigured(): boolean {
  return redisClient() !== null;
}
