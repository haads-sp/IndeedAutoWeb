import { describe, expect, it } from 'vitest';

import { requestIsHttps, sessionCookieOptions } from '@/lib/supabase/cookie-options';

/**
 * These assertions exist because the flags were once set in only ONE of the two places
 * that write session cookies. Everything built, every test passed, and production served
 * session cookies with no HttpOnly. See docs/ISSUES.md row 2.
 */
describe('session cookie attributes', () => {
  it('always sets HttpOnly, whatever the library suggests', () => {
    expect(sessionCookieOptions({ httpOnly: false }, true).httpOnly).toBe(true);
    expect(sessionCookieOptions(undefined, true).httpOnly).toBe(true);
  });

  it('always sets SameSite=Lax', () => {
    expect(sessionCookieOptions({ sameSite: 'none' }, true).sameSite).toBe('lax');
    expect(sessionCookieOptions(undefined, false).sameSite).toBe('lax');
  });

  it('sets Secure over https', () => {
    expect(sessionCookieOptions(undefined, true).secure).toBe(true);
  });

  it('omits Secure over plain http, or local development cannot sign in at all', () => {
    expect(sessionCookieOptions(undefined, false).secure).toBe(false);
  });

  it('scopes the cookie to the whole app', () => {
    expect(sessionCookieOptions({ path: '/narrow' }, true).path).toBe('/');
  });

  it('our attributes win over the library, never the other way round', () => {
    const hostile = { httpOnly: false, secure: false, sameSite: 'none', path: '/x' } as const;
    const result = sessionCookieOptions(hostile, true);

    expect(result.httpOnly).toBe(true);
    expect(result.sameSite).toBe('lax');
    expect(result.secure).toBe(true);
    expect(result.path).toBe('/');
  });

  it('preserves unrelated options such as maxAge', () => {
    expect(sessionCookieOptions({ maxAge: 3600 }, true).maxAge).toBe(3600);
  });
});

describe('https detection', () => {
  it('trusts x-forwarded-proto, which Vercel sets', () => {
    expect(requestIsHttps(new Headers({ 'x-forwarded-proto': 'https' }))).toBe(true);
    expect(requestIsHttps(new Headers({ 'x-forwarded-proto': 'http' }))).toBe(false);
  });

  it('reads the first entry of a comma-separated chain', () => {
    expect(requestIsHttps(new Headers({ 'x-forwarded-proto': 'https,http' }))).toBe(true);
  });

  it('defaults to false with no header, which is the safe direction', () => {
    // Costs the Secure flag locally; never removes it in production, where Vercel
    // always sets the header.
    expect(requestIsHttps(new Headers())).toBe(false);
  });

  it('ignores Cloudflare headers entirely', () => {
    // BUILD-PLAN.md §4.4: Cloudflare is DNS-only and not in the request path.
    expect(requestIsHttps(new Headers({ 'cf-visitor': '{"scheme":"https"}' }))).toBe(false);
  });
});
