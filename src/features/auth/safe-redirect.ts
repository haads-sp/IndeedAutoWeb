/**
 * Open-redirect guard for the `next` parameter on confirmation links.
 *
 * The attack this prevents: a crafted link that legitimately confirms a user's email —
 * so it works, and looks trustworthy — and then forwards them to an attacker's page,
 * arriving freshly authenticated and primed to trust whatever is there. The link genuinely
 * comes from our domain, which is what makes it effective.
 *
 * The rule is allow-listing by shape: same-origin absolute PATHS only.
 */

export const DEFAULT_NEXT = '/ping';

export function safeNext(next: string | null | undefined): string {
  if (!next) return DEFAULT_NEXT;

  // Must be an absolute path on this origin.
  if (!next.startsWith('/')) return DEFAULT_NEXT;

  // `//evil.com` is protocol-relative and resolves OFF this origin. So does `/\evil.com`
  // in several browsers, which normalise the backslash to a forward slash.
  if (next.startsWith('//') || next.startsWith('/\\')) return DEFAULT_NEXT;

  // A control character or newline can be used to smuggle a header or confuse a parser.
  if (/[\u0000-\u001f\u007f]/.test(next)) return DEFAULT_NEXT;

  return next;
}
