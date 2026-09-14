import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyOtp } = vi.hoisted(() => ({ verifyOtp: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { verifyOtp } }),
}));

import { confirmLink, failureDestination, parseConfirmLink } from './confirm-link';

const GOOD = { tokenHash: 'a1b2c3d4e5f6', type: 'email', next: '/portal' } as const;

beforeEach(() => {
  verifyOtp.mockReset();
  verifyOtp.mockResolvedValue({ data: {}, error: null });
});

describe('parseConfirmLink: what the page will render a button for', () => {
  it('accepts a well-formed link', () => {
    expect(parseConfirmLink(GOOD)).toEqual({ ok: true, link: GOOD });
  });

  it.each([
    ['a missing token', { ...GOOD, tokenHash: undefined }],
    ['an empty token', { ...GOOD, tokenHash: '' }],
    ['markup in the token', { ...GOOD, tokenHash: '"><script>alert(1)</script>' }],
    ['whitespace in the token', { ...GOOD, tokenHash: 'abc def' }],
    ['an absurdly long token', { ...GOOD, tokenHash: 'a'.repeat(513) }],
    ['a token sent twice (an array)', { ...GOOD, tokenHash: ['a', 'b'] }],
    ['a type this app never issues', { ...GOOD, type: 'magiclink' }],
    ['a missing type', { ...GOOD, type: undefined }],
  ])('rejects %s', (_label, input) => {
    expect(parseConfirmLink(input).ok).toBe(false);
  });

  it.each([['//example.com'], ['https://example.com'], ['/\\example.com'], ['javascript:alert(1)']])(
    'never carries an open redirect forward: next=%s becomes /portal',
    (next) => {
      const parsed = parseConfirmLink({ ...GOOD, next });
      expect(parsed.ok && parsed.link.next).toBe('/portal');
    },
  );

  it('sends a failed RESET link back to the reset flow, and anything else to verify-email', () => {
    expect(failureDestination('recovery')).toBe('/forgot-password?outcome=link_expired');
    expect(failureDestination('email')).toBe('/verify-email?state=invalid');
    expect(failureDestination(undefined)).toBe('/verify-email?state=invalid');
  });
});

describe('confirmLink: the only step that spends the token', () => {
  it('re-validates the submitted form instead of trusting the page: a tampered field never reaches Supabase', async () => {
    const result = await confirmLink({ ...GOOD, type: 'magiclink' });
    expect(result.outcome).toBe('link_invalid');
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('re-applies the open-redirect guard to the submitted next', async () => {
    expect(await confirmLink({ ...GOOD, next: '//example.com' })).toEqual({
      outcome: 'confirmed',
      destination: '/portal',
    });
  });

  it('confirms with exactly the token and type it was given', async () => {
    const result = await confirmLink({ ...GOOD, type: 'recovery', next: '/reset-password' });
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: GOOD.tokenHash });
    expect(result).toEqual({ outcome: 'confirmed', destination: '/reset-password' });
  });

  it.each([400, 401, 403, 404, 422])('a %s from Supabase is the token being refused', async (status) => {
    verifyOtp.mockResolvedValue({
      data: {},
      error: { status, message: 'Email link is invalid or has expired' },
    });
    expect(await confirmLink({ ...GOOD, type: 'recovery' })).toEqual({
      outcome: 'link_rejected',
      destination: '/forgot-password?outcome=link_expired',
    });
  });

  it.each([
    ['a 500', { status: 500, message: 'Internal error' }],
    ['a 429', { status: 429, message: 'Too many requests' }],
    ['a network failure (status 0)', { status: 0, message: 'fetch failed' }],
  ])('%s is NOT reported to the person as an expired link', async (_label, error) => {
    verifyOtp.mockResolvedValue({ data: {}, error });
    const result = await confirmLink(GOOD);
    expect(result.outcome).toBe('unavailable');
    expect(result.destination).toMatch(/^\/auth\/confirm\?/);
    expect(result.destination).toContain('outcome=unavailable');
  });

  it('a thrown failure is caught, not turned into a crash', async () => {
    verifyOtp.mockRejectedValue(new Error('socket hang up'));
    expect((await confirmLink(GOOD)).outcome).toBe('unavailable');
  });
});
