/**
 * The Content-Security-Policy for pages. BUILD-PLAN.md Stage 10.
 *
 * Nonce-based and strict, following Next.js 16's own guidance: every script must carry this
 * request's nonce, and 'strict-dynamic' lets those scripts load their own dependencies without
 * an allow-list of hosts. An injected <script> — the point of an XSS — has no nonce and does
 * not run.
 *
 * Pure, so the policy can be asserted in tests rather than read off a response and trusted.
 */

export interface CspContext {
  /** Development needs 'unsafe-eval': React uses eval to rebuild server error stacks. */
  readonly isDevelopment: boolean;
  /**
   * upgrade-insecure-requests only over HTTPS. On a plain-http origin it rewrites every
   * subresource to https — so the E2E suite, which runs a production build over
   * http://127.0.0.1, would have all its scripts blocked.
   */
  readonly isHttps: boolean;
}

/** An unguessable, per-request nonce. */
export function createNonce(): string {
  return btoa(crypto.randomUUID());
}

export function contentSecurityPolicy(nonce: string, context: CspContext): string {
  const directives: string[] = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${context.isDevelopment ? " 'unsafe-eval'" : ''}`,
    // Development injects un-nonced styles for hot reloading; production gets the nonce.
    `style-src 'self' ${context.isDevelopment ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    // Server Actions post to this origin, and there is no browser Sentry to report to.
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // Forms may only submit here. A page that injected a form cannot post credentials away.
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  if (context.isHttps) directives.push('upgrade-insecure-requests');

  return directives.join('; ');
}
