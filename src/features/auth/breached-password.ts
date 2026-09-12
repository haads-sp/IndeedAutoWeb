/**
 * Breached-password check, via HaveIBeenPwned's k-anonymity range API.
 *
 * BUILD-PLAN.md Stage 3 asks to "check against a breached-password list if Supabase
 * offers it". Supabase does offer it, but only on the Pro plan, so this implements the
 * same check directly. See docs/DECISIONS.md.
 *
 * **The password never leaves this process, and neither does its full hash.** We send the
 * FIRST FIVE characters of the SHA-1 hash and receive every suffix HIBP holds for that
 * prefix — tens of thousands of them — then match locally. HIBP cannot tell which
 * candidate was ours, and cannot reconstruct the password from five hex characters.
 */

import { createHash } from 'node:crypto';

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';

/** HIBP is a third party on the signup path; it does not get to hang it. */
const TIMEOUT_MS = 2500;

export type BreachCheck =
  | { status: 'safe' }
  | { status: 'breached'; count: number }
  | { status: 'unavailable' };

/**
 * @returns `breached` with an occurrence count, `safe`, or `unavailable` when HIBP could
 * not be reached.
 *
 * **Fails open.** If HIBP is down, signup proceeds. That is a deliberate trade: the
 * alternative is that an outage at a third party stops all account creation, to enforce
 * a check that is defence in depth rather than the security boundary. The caller decides
 * what to do with `unavailable`; it must not be treated as `breached`.
 */
export async function checkBreachedPassword(password: string): Promise<BreachCheck> {
  const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  let body: string;
  try {
    const response = await fetch(HIBP_RANGE_URL + prefix, {
      // Add-Padding makes every response a similar size, so an observer watching
      // response length cannot infer whether the prefix had few or many hits.
      headers: { 'Add-Padding': 'true', 'User-Agent': 'IndeedAutoWeb-signup' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) return { status: 'unavailable' };
    body = await response.text();
  } catch {
    // Network error, timeout, or abort. Fails open by design.
    return { status: 'unavailable' };
  }

  for (const line of body.split('\n')) {
    const [candidate, countText] = line.trim().split(':');
    if (candidate === suffix) {
      const count = Number.parseInt(countText ?? '0', 10);
      // Padding entries are returned with a count of 0 and must not count as a hit.
      if (count > 0) return { status: 'breached', count };
      return { status: 'safe' };
    }
  }

  return { status: 'safe' };
}
