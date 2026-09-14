import { describe, expect, it } from 'vitest';

import { redactDeep, redactString, stripQuery } from '@/lib/logging/redact';

import { scrubEvent, sentryServerOptions } from './sentry-options';

/**
 * The fakes below are ASSEMBLED AT RUNTIME, never written as literals: a key- or JWT-shaped
 * literal in this file would be flagged by scripts/secret-scan.mjs and by gitleaks, in CI and
 * in history, forever. Same approach as tests/secret-scan.test.ts.
 */
const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** A JWT-shaped string, like the value of an sb- session cookie. */
const JWT = [
  b64url({ alg: 'ES256', typ: 'JWT' }),
  b64url({ sub: '8a0d1e65', email: 'a@example.com' }),
  Buffer.from('signature-bytes-here').toString('base64url'),
].join('.');

/** A Supabase secret-key-shaped string. */
const FAKE_SECRET_KEY = `sb_${'secret'}_${'9xQ2vR7tLm4KpZ3w'}${'E8sNdF6hJbC1yA5u'}`;

/**
 * Everything this application could plausibly leak into an error event, in one place.
 * BUILD-PLAN.md Stage 10: "no tokens, emails, or passwords in captured events."
 */
function hostileEvent() {
  return {
    message: `Failed for someone.name@example.com with token ${JWT}`,
    exception: { values: [{ value: 'boom at /auth/confirm?token_hash=abc123SECRETabc&type=recovery' }] },
    request: {
      url: 'https://www.alsayeed.ca/auth/confirm?token_hash=abc123SECRETabc&type=recovery',
      query_string: 'token_hash=abc123SECRETabc',
      cookies: { 'sb-ghiawrvz-auth-token': JWT },
      headers: { authorization: `Bearer ${JWT}`, cookie: `sb-auth=${JWT}`, 'user-agent': 'Mozilla' },
      data: { email: 'someone.name@example.com', password: 'hunter2hunter2hunter2' },
    },
    // Where Sentry's captureRequestError puts Next's request.path — query string included.
    contexts: { nextjs: { request_path: '/auth/confirm?token_hash=abc123SECRETabc&type=recovery', route_type: 'render' } },
    user: { id: '8a0d1e65', email: 'someone.name@example.com', ip_address: '203.0.113.9' },
    extra: {
      note: 'reset for other.person@example.org',
      key: FAKE_SECRET_KEY,
      nested: { password: 'deep-secret-value', ok: 'harmless' },
    },
    breadcrumbs: [{ message: `GET /login?email=someone.name@example.com` }],
  };
}

describe('scrubEvent: nothing sensitive survives, whatever the SDK attached', () => {
  const serialised = JSON.stringify(scrubEvent(hostileEvent()));

  it.each([
    ['a session JWT', JWT],
    ['a password', 'hunter2hunter2hunter2'],
    ['a nested password', 'deep-secret-value'],
    ['a single-use auth token from a URL', 'abc123SECRETabc'],
    ['a full email address', 'someone.name@example.com'],
    ['a second email address', 'other.person@example.org'],
    ['a Supabase secret key', FAKE_SECRET_KEY],
    ['the user IP', '203.0.113.9'],
  ])('does not contain %s', (_label, needle) => {
    expect(serialised).not.toContain(needle);
  });

  it('removes cookies, headers, request body and the user entirely', () => {
    const clean = scrubEvent(hostileEvent())!;
    expect(clean.request?.cookies).toBeUndefined();
    expect(clean.request?.headers).toBeUndefined();
    expect(clean.request?.data).toBeUndefined();
    expect(clean.request?.query_string).toBeUndefined();
    expect(clean.user).toBeUndefined();
  });

  it('keeps the path, so the event is still useful', () => {
    expect(scrubEvent(hostileEvent())!.request?.url).toBe('https://www.alsayeed.ca/auth/confirm');
  });

  it("strips the query string from Next's request path, not only from request.url", () => {
    const clean = scrubEvent(hostileEvent()) as ReturnType<typeof hostileEvent>;
    expect(clean.contexts.nextjs.request_path).toBe('/auth/confirm');
    expect(clean.contexts.nextjs.route_type).toBe('render');
  });

  it('keeps harmless values', () => {
    const clean = scrubEvent(hostileEvent()) as ReturnType<typeof hostileEvent>;
    expect(clean.extra.nested.ok).toBe('harmless');
  });

  it("drops Next's refusal of a cross-site Server Action — CSRF protection working, not a bug", () => {
    expect(scrubEvent({ exception: { values: [{ value: 'Invalid Server Actions request.' }] } })).toBeNull();
  });

  it('does NOT drop real errors that merely mention Server Actions', () => {
    expect(scrubEvent({ message: 'Server Actions failed to connect to database' })).not.toBeNull();
  });
});

describe('Sentry is told to collect nothing by default', () => {
  const options = sentryServerOptions({ dsn: 'https://k@o1.ingest.sentry.io/1', environment: 'test', release: 'abc' });

  // Each of these defaults to COLLECTING in @sentry/nextjs 10.x. See sentry-options.ts.
  it.each([
    ['cookies', options.dataCollection.cookies, false],
    ['request headers', options.dataCollection.httpHeaders.request, false],
    ['response headers', options.dataCollection.httpHeaders.response, false],
    ['URL query parameters', options.dataCollection.urlQueryParams, false],
    ['database query data', options.dataCollection.databaseQueryData, false],
    ['stack-frame local variables', options.dataCollection.stackFrameVariables, false],
    ['user info', options.dataCollection.userInfo, false],
  ])('%s is explicitly off', (_label, actual, expected) => {
    expect(actual).toBe(expected);
  });

  it('collects no HTTP bodies at all — an empty list, not an omitted one', () => {
    // Omitted means "all body types"; only [] disables collection.
    expect(options.dataCollection.httpBodies).toEqual([]);
  });

  it('sends no performance transactions', () => {
    expect(options.tracesSampleRate).toBe(0);
    expect(options.beforeSendTransaction()).toBeNull();
  });
});

describe('redaction primitives', () => {
  it('strips query strings and fragments', () => {
    expect(stripQuery('https://x.test/a/b?token=1#frag')).toBe('https://x.test/a/b');
    expect(stripQuery('https://x.test/a')).toBe('https://x.test/a');
  });

  it('redacts credential query parameters even inside prose', () => {
    expect(redactString('see /x?token_hash=SECRET&type=email')).toBe(
      'see /x?token_hash=[redacted]&type=email',
    );
  });

  it('tolerates cyclic objects', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(() => redactDeep(a)).not.toThrow();
  });
});
