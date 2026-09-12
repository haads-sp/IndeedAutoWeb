import 'server-only';

/**
 * The client's public IP address, for rate limiting.
 *
 * BUILD-PLAN.md §4.4: "For client IP, use the standard Vercel request headers." Never
 * `CF-Connecting-IP` — Cloudflare is DNS-only here and that header will not exist.
 *
 * **These headers are trustworthy on Vercel, which is not true of `x-forwarded-for` in
 * general.** Vercel's docs: "we currently overwrite the X-Forwarded-For header and do not
 * forward external IPs. This restriction is in place to prevent IP spoofing." So the value
 * is set by Vercel from the connection, not copied from anything the client sent. Reading
 * the first entry is therefore safe here, where on an ordinary reverse proxy it would let
 * an attacker pick their own rate-limit bucket by sending a header.
 */

/**
 * In preference order:
 *
 * 1. `x-vercel-forwarded-for` — identical to x-forwarded-for, but cannot be overwritten
 *    by a proxy sitting on top of Vercel. The most robust of the three.
 * 2. `x-real-ip` — documented as identical.
 * 3. `x-forwarded-for` — same value; take the first entry.
 */
const IP_HEADERS = ['x-vercel-forwarded-for', 'x-real-ip', 'x-forwarded-for'] as const;

export function clientIp(headers: Headers): string | null {
  for (const name of IP_HEADERS) {
    const raw = headers.get(name);
    if (!raw) continue;

    const first = raw.split(',')[0]?.trim();
    if (first) return first;
  }

  // Local development, or a runtime that sets none of them. The caller must treat null as
  // "unknown", never as a rate-limit key — bucketing every unknown client together would
  // let one attacker exhaust the limit for everyone.
  return null;
}
