import 'server-only';

/**
 * Consuming the link in an auth email (signup confirmation, password reset, email change).
 *
 * TWO STEPS, NEVER ONE:
 *   1. GET /auth/confirm shows a page with a button. Opening the link changes nothing.
 *   2. Pressing the button submits a Server Action, which consumes the single-use token.
 *
 * Supabase's own examples consume the token on GET. That is refused here for two reasons
 * (docs/DECISIONS.md):
 *
 *   - Mail scanners open links. Corporate gateways and some mail providers fetch every link
 *     in a message before the person sees it. A GET that consumes a single-use token lets
 *     the scanner spend it, and the person's own click then fails as "expired".
 *   - Login CSRF (BUILD-PLAN.md Stage 10, "CSRF protection on state-changing routes"). A GET
 *     that signs someone in can be triggered by any page they visit: a redirect to
 *     /auth/confirm carrying the ATTACKER's token signs the victim into the attacker's
 *     account, where whatever they type next is the attacker's to read. Next.js refuses a
 *     Server Action POST whose Origin is not this site, and a navigation alone now does
 *     nothing.
 *
 * The session cookie is still written server-side, by our own server client, which is why
 * the email templates point here rather than at Supabase's ConfirmationURL (docs/EXTENDING.md).
 */

import { createClient } from '@/lib/supabase/server';

import { safeNext } from './safe-redirect';

/** Only the types this app actually issues. An unexpected value is rejected, not passed through. */
export const CONFIRMABLE_TYPES = ['email', 'signup', 'recovery', 'email_change'] as const;
export type ConfirmableType = (typeof CONFIRMABLE_TYPES)[number];

/**
 * Supabase issues token hashes as short hex strings (with a `pkce_` prefix in some flows).
 * The allowed shape is deliberately a little wider than that, so a format change upstream
 * is rejected by Supabase, which says why, rather than silently here. What it excludes is
 * anything that is not a token: markup, quotes, whitespace, or megabytes of input echoed
 * into a hidden form field.
 */
const TOKEN_HASH = /^[A-Za-z0-9_-]{1,512}$/;

export interface ConfirmLink {
  readonly tokenHash: string;
  readonly type: ConfirmableType;
  /** Already passed through safeNext(): a same-origin path, never an open redirect. */
  readonly next: string;
}

export type ParsedConfirmLink =
  | { readonly ok: true; readonly link: ConfirmLink }
  | { readonly ok: false; readonly destination: string };

function isConfirmableType(value: unknown): value is ConfirmableType {
  return typeof value === 'string' && (CONFIRMABLE_TYPES as readonly string[]).includes(value);
}

/**
 * Where a link that did not work sends the person: back to the flow it came FROM. Sending
 * every failure to /verify-email told someone with an expired password-reset link to "sign
 * up again with the same address", which is wrong and, for an existing account, alarming.
 */
export function failureDestination(type: unknown): string {
  return type === 'recovery' ? '/forgot-password?outcome=link_expired' : '/verify-email?state=invalid';
}

/**
 * Validates a link's parameters. Pure.
 *
 * Used by BOTH steps: by the page, on the query string, and again by the action, on the
 * submitted form. A hidden form field is user input like any other (it can be edited before
 * the button is pressed), so nothing the page checked is trusted by the action.
 */
export function parseConfirmLink(input: {
  readonly tokenHash: unknown;
  readonly type: unknown;
  readonly next: unknown;
}): ParsedConfirmLink {
  if (
    typeof input.tokenHash !== 'string' ||
    !TOKEN_HASH.test(input.tokenHash) ||
    !isConfirmableType(input.type)
  ) {
    return { ok: false, destination: failureDestination(input.type) };
  }

  return {
    ok: true,
    link: {
      tokenHash: input.tokenHash,
      type: input.type,
      next: safeNext(typeof input.next === 'string' ? input.next : null),
    },
  };
}

export type ConfirmOutcome =
  | { readonly outcome: 'confirmed'; readonly destination: string }
  /** Malformed parameters. Never sent to Supabase. */
  | { readonly outcome: 'link_invalid'; readonly destination: string }
  /**
   * Supabase refused the token: expired, already used, or never valid. The distinction is not
   * shown, because the person does the same thing in every case: requests a new link. This
   * is also where "single-use" is enforced. verifyOtp consumes the token, so a second press
   * lands here.
   */
  | { readonly outcome: 'link_rejected'; readonly destination: string }
  /** Supabase could not be reached, or failed. The link may still be good. */
  | { readonly outcome: 'unavailable'; readonly destination: string };

/** A 4xx other than 429 is Supabase judging the TOKEN. Anything else is Supabase itself. */
function isTokenRejection(status: number | undefined): boolean {
  return status !== undefined && status >= 400 && status < 500 && status !== 429;
}

/** Step 2: consumes the token. Only ever called from the Server Action. */
export async function confirmLink(
  input: Parameters<typeof parseConfirmLink>[0],
): Promise<ConfirmOutcome> {
  const parsed = parseConfirmLink(input);
  if (!parsed.ok) {
    return { outcome: 'link_invalid', destination: parsed.destination };
  }

  const { link } = parsed;

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type: link.type, token_hash: link.tokenHash });

    if (!error) {
      return { outcome: 'confirmed', destination: link.next };
    }

    if (isTokenRejection(error.status)) {
      return { outcome: 'link_rejected', destination: failureDestination(link.type) };
    }
  } catch {
    // A thrown network failure lands here rather than crashing to an error page (P3).
  }

  // Back to the same page, which says to try again. NOT to the "expired" page: the link may
  // well still work, and telling someone it has expired when it has not is a false statement
  // about their account (P7).
  const retry = new URLSearchParams({
    token_hash: link.tokenHash,
    type: link.type,
    next: link.next,
    outcome: 'unavailable',
  });
  return { outcome: 'unavailable', destination: `/auth/confirm?${retry.toString()}` };
}
