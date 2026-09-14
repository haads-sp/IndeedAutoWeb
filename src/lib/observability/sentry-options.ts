/**
 * Sentry configuration, as a pure function of its inputs so it can be tested without a
 * network or a DSN.
 *
 * BUILD-PLAN.md Stage 10: "Sentry configured to scrub PII — no tokens, emails, or passwords in
 * captured events."
 *
 * TWO LAYERS, because either alone has failed somewhere before:
 *
 *   1. COLLECT NOTHING BY DEFAULT. In @sentry/nextjs 10.x `sendDefaultPii` is deprecated and
 *      replaced by `dataCollection`, whose installed type definitions give these defaults:
 *      cookies true, request/response headers true, request bodies ALL, URL query parameters
 *      true, database query data true, stack-frame local variables true. For this app that
 *      means session JWTs (cookies), passwords (signup/login bodies), single-use auth tokens
 *      (`/auth/confirm?token_hash=`) and, in a crash, a local variable named `password`.
 *      Every category is therefore set EXPLICITLY below — no default is relied on. See
 *      docs/DOMAIN.md.
 *
 *   2. SCRUB WHAT GETS THROUGH ANYWAY. beforeSend, beforeBreadcrumb and beforeSendLog run every
 *      payload through redactDeep() and strip query strings from URLs.
 */

import { redactDeep, stripQuery } from '@/lib/logging/redact';

export interface SentryOptionsInput {
  readonly dsn: string;
  readonly environment: string;
  readonly release: string | undefined;
}

/**
 * Errors that are not errors. Next.js refuses a cross-site Server Action POST by throwing,
 * which surfaces as a 500 — that refusal is CSRF protection WORKING (verified: a POST with
 * `Origin: https://evil.example` is rejected). Reporting each attempt would spend the error
 * quota on attacks that already failed, and train people to ignore Sentry.
 */
const EXPECTED_NOISE = [/Invalid Server Actions request/i];

type AnyEvent = {
  message?: string;
  exception?: { values?: Array<{ value?: string }> };
  request?: { url?: string; query_string?: unknown; cookies?: unknown; headers?: unknown; data?: unknown };
  contexts?: { nextjs?: { request_path?: unknown; [key: string]: unknown }; [key: string]: unknown };
  user?: unknown;
  [key: string]: unknown;
};

function isExpectedNoise(event: AnyEvent): boolean {
  const texts = [event.message, ...(event.exception?.values ?? []).map((v) => v.value)];
  return texts.some((text) => typeof text === 'string' && EXPECTED_NOISE.some((p) => p.test(text)));
}

/** Exported for tests. Returns null to drop the event. */
export function scrubEvent<E extends AnyEvent>(event: E): E | null {
  if (isExpectedNoise(event)) return null;

  const clean = redactDeep(event);

  // Belt and braces over dataCollection: these are removed whatever the SDK attached.
  if (clean.request) {
    if (typeof clean.request.url === 'string') clean.request.url = stripQuery(clean.request.url);
    delete clean.request.query_string;
    delete clean.request.cookies;
    delete clean.request.headers;
    delete clean.request.data;
  }
  delete clean.user;

  // Sentry's captureRequestError copies Next's request.path here, and Next documents that
  // path as including the query string ("/blog?name=foo") — so /auth/confirm?token_hash=…
  // would otherwise arrive intact under a key no request-scrubbing setting covers.
  const nextjs = clean.contexts?.nextjs;
  if (nextjs && typeof nextjs.request_path === 'string') {
    nextjs.request_path = stripQuery(nextjs.request_path);
  }

  return clean;
}

export function sentryServerOptions(input: SentryOptionsInput) {
  return {
    dsn: input.dsn,
    environment: input.environment,
    release: input.release,

    // Deprecated in 10.x, set anyway: it costs nothing and fails closed if a future version
    // reinterprets defaults.
    sendDefaultPii: false,

    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      // NOT a deny-list of names: the SDK's own type docs warn that minification renames
      // locals, so `password` may reach Sentry as `a`. Off entirely.
      stackFrameVariables: false,
    },

    // No performance tracing. Spans carry URLs and database operations, and nothing in this
    // phase needs them. Errors only.
    tracesSampleRate: 0,

    // Sentry Logs: where structured events become durable (docs/DECISIONS.md, Stage 9).
    enableLogs: true,

    // Generic so each hook is assignable to Sentry's own signature without restating its types.
    beforeSend: <E extends AnyEvent>(event: E) => scrubEvent(event),
    beforeSendTransaction: () => null,
    beforeBreadcrumb: <B extends object>(breadcrumb: B) => redactDeep(breadcrumb),
    beforeSendLog: <L extends object>(log: L) => redactDeep(log),
  };
}
