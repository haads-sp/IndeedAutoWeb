import { describe, expect, it } from 'vitest';

import { contentSecurityPolicy, createNonce } from './csp';

/** Parses a policy into directive -> sources, so assertions are about meaning, not string order. */
function parse(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...sources] = part.split(/\s+/);
        return [name, sources] as const;
      }),
  );
}

const NONCE = 'bm9uY2UtZm9yLXRlc3Rz';
const production = parse(contentSecurityPolicy(NONCE, { isDevelopment: false, isHttps: true }));
const development = parse(contentSecurityPolicy(NONCE, { isDevelopment: true, isHttps: false }));

describe('production policy: an injected script does not run', () => {
  it("scripts need this request's nonce, and strict-dynamic ignores host allow-lists", () => {
    expect(production.get('script-src')).toEqual(["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"]);
  });

  it.each(["'unsafe-inline'", "'unsafe-eval'", '*', 'data:', 'https:'])('script-src never allows %s', (source) => {
    expect(production.get('script-src')).not.toContain(source);
  });

  it('inline styles need the nonce too; unsafe-inline is never allowed in production', () => {
    expect(production.get('style-src')).toContain(`'nonce-${NONCE}'`);
    expect(production.get('style-src')).not.toContain("'unsafe-inline'");
  });

  it.each([
    ['default-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
    ['connect-src', ["'self'"]],
  ])('%s is %j', (directive, sources) => {
    expect(production.get(directive)).toEqual(sources);
  });

  it('upgrades insecure requests over HTTPS', () => {
    expect(production.has('upgrade-insecure-requests')).toBe(true);
  });

  it('is a single header line: no newline can split it', () => {
    expect(contentSecurityPolicy(NONCE, { isDevelopment: false, isHttps: true })).not.toMatch(/[\r\n]/);
  });
});

describe('development and plain-http differences are deliberate and narrow', () => {
  it("development adds only 'unsafe-eval' to scripts, which React needs to rebuild server error stacks", () => {
    expect(development.get('script-src')).toEqual([
      "'self'",
      `'nonce-${NONCE}'`,
      "'strict-dynamic'",
      "'unsafe-eval'",
    ]);
  });

  it('development allows inline styles, for hot reloading', () => {
    expect(development.get('style-src')).toContain("'unsafe-inline'");
  });

  it('plain http does not upgrade requests, or every script on http://127.0.0.1 would be blocked', () => {
    expect(development.has('upgrade-insecure-requests')).toBe(false);
  });
});

describe('createNonce', () => {
  it('is different every time', () => {
    const nonces = new Set(Array.from({ length: 1000 }, () => createNonce()));
    expect(nonces.size).toBe(1000);
  });

  it('is base64, so it cannot break out of the header or the directive', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(createNonce()).toMatch(/^[A-Za-z0-9+/]+=*$/);
    }
  });

  it('is at least 128 bits long before encoding, as CSP Level 3 recommends', () => {
    // btoa of a 36-character UUID string: 288 bits before encoding (122 of them random), 48 characters after.
    expect(createNonce().length).toBeGreaterThanOrEqual(48);
  });
});
