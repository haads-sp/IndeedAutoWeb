import { describe, expect, it } from 'vitest';

import { clientIp } from '@/lib/request/client-ip';

describe('client IP extraction', () => {
  /**
   * These headers are trustworthy specifically on Vercel, which overwrites
   * x-forwarded-for and does not forward external IPs "to prevent IP spoofing".
   * On an ordinary reverse proxy, reading the first entry would let a client choose
   * its own rate-limit bucket.
   */
  it('prefers x-vercel-forwarded-for, which a proxy on top of Vercel cannot overwrite', () => {
    const headers = new Headers({
      'x-vercel-forwarded-for': '203.0.113.9',
      'x-real-ip': '198.51.100.7',
      'x-forwarded-for': '192.0.2.1',
    });
    expect(clientIp(headers)).toBe('203.0.113.9');
  });

  it('falls back to x-real-ip', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7');
  });

  it('falls back to x-forwarded-for', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '192.0.2.1' }))).toBe('192.0.2.1');
  });

  it('takes the first entry of a comma-separated chain', () => {
    const headers = new Headers({ 'x-forwarded-for': '192.0.2.1, 70.41.3.18, 150.172.238.178' });
    expect(clientIp(headers)).toBe('192.0.2.1');
  });

  it('trims whitespace around the entry', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '  192.0.2.1  , 70.41.3.18' }))).toBe(
      '192.0.2.1',
    );
  });

  it('returns null when no header is present, rather than a placeholder', () => {
    // Must be null, never a constant like 'unknown'. A shared placeholder would put every
    // unidentifiable client in one rate-limit bucket, letting one attacker exhaust the
    // limit for everybody.
    expect(clientIp(new Headers())).toBeNull();
  });

  it('returns null for an empty header value', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '' }))).toBeNull();
  });

  it('never reads CF-Connecting-IP', () => {
    // BUILD-PLAN.md §4.4: Cloudflare is DNS-only, so this header does not exist here.
    // Honouring it would let anyone set their own IP by sending the header.
    const headers = new Headers({ 'cf-connecting-ip': '203.0.113.99' });
    expect(clientIp(headers)).toBeNull();
  });
});
