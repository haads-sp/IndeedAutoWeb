import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resetPasswordForEmail, checkRateLimit } = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { resetPasswordForEmail } }),
}));

vi.mock('./rate-limit', () => ({ checkRateLimit }));

vi.mock('@/lib/env/site-url', () => ({
  absoluteUrl: (path: string) => `https://www.alsayeed.ca${path}`,
}));

import { RECOVERY_WINDOW_SECONDS, isFreshRecovery, requestPasswordReset } from './password-reset';

beforeEach(() => {
  resetPasswordForEmail.mockReset();
  checkRateLimit.mockReset();
  checkRateLimit.mockResolvedValue({ allowed: true, enforced: true });
});

describe('requesting a reset: identical response for known and unknown addresses', () => {
  it('returns reset_requested when Supabase accepts the request', async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    expect(await requestPasswordReset('a@example.com', '203.0.113.9')).toEqual({
      outcome: 'reset_requested',
    });
  });

  /**
   * THE ORACLE CASE. Supabase throttles repeat recovery emails per address, but only
   * addresses with an account ever send one. A second quick request can therefore return
   * 429 for a real account and 200 for an unknown address. Surfacing that difference
   * reveals which addresses have accounts — the one thing this flow must not reveal.
   */
  it("returns the SAME outcome when Supabase's own limiter returns 429", async () => {
    resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { status: 429, message: 'For security purposes, you can only request this after 60 seconds.' },
    });
    expect(await requestPasswordReset('a@example.com', '203.0.113.9')).toEqual({
      outcome: 'reset_requested',
    });
  });

  it('returns the SAME outcome for any other Supabase error', async () => {
    resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { status: 400, message: 'User not found' },
    });
    expect(await requestPasswordReset('a@example.com', null)).toEqual({
      outcome: 'reset_requested',
    });
  });

  it('returns the SAME outcome, rather than crashing, if the call throws', async () => {
    resetPasswordForEmail.mockRejectedValue(new Error('fetch failed'));
    expect(await requestPasswordReset('a@example.com', null)).toEqual({
      outcome: 'reset_requested',
    });
  });

  it('rejects a malformed address without contacting Supabase', async () => {
    expect(await requestPasswordReset('not-an-email', null)).toEqual({ outcome: 'invalid_email' });
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it('reports OUR rate limit, which keys on the typed address whether or not it has an account', async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 42 });
    expect(await requestPasswordReset('a@example.com', null)).toEqual({
      outcome: 'rate_limited',
      retryAfterSeconds: 42,
    });
    // Limited before Supabase is contacted, so a limited request sends no email.
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('uses the password-reset limit, not the login limit', async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    await requestPasswordReset('a@example.com', '203.0.113.9');
    // Separate buckets: tripping login's limit must not block a legitimate reset.
    expect(checkRateLimit).toHaveBeenCalledWith('passwordReset', 'a@example.com', '203.0.113.9');
  });

  it('normalises the address before limiting and before sending', async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    await requestPasswordReset('  A@Example.COM ', null);

    // Otherwise "A@example.com" and "a@example.com" would get separate rate-limit buckets.
    expect(checkRateLimit).toHaveBeenCalledWith('passwordReset', 'a@example.com', null);
    expect(resetPasswordForEmail).toHaveBeenCalledWith('a@example.com', {
      redirectTo: 'https://www.alsayeed.ca/auth/confirm',
    });
  });
});

describe('isFreshRecovery: who may set a new password', () => {
  const NOW = 1_800_000_000;

  it('accepts a one-time-code sign-in within the window', () => {
    expect(isFreshRecovery([{ method: 'otp', timestamp: NOW - 60 }], NOW)).toBe(true);
  });

  it('accepts a sign-in exactly at the edge of the window', () => {
    expect(isFreshRecovery([{ method: 'otp', timestamp: NOW - RECOVERY_WINDOW_SECONDS }], NOW)).toBe(
      true,
    );
  });

  it('rejects a one-time-code sign-in older than the window', () => {
    // A confirmation link clicked weeks ago, kept alive by refresh, must not allow a
    // password change today.
    expect(
      isFreshRecovery([{ method: 'otp', timestamp: NOW - RECOVERY_WINDOW_SECONDS - 1 }], NOW),
    ).toBe(false);
  });

  /**
   * The threat this whole check exists for: someone at an unlocked, signed-in computer.
   * They have a valid session, and it was established with a PASSWORD — not by proving
   * control of the inbox.
   */
  it('rejects a PASSWORD sign-in, however recent', () => {
    expect(isFreshRecovery([{ method: 'password', timestamp: NOW - 5 }], NOW)).toBe(false);
  });

  it('accepts when any entry is a fresh inbox proof', () => {
    expect(
      isFreshRecovery(
        [
          { method: 'password', timestamp: NOW - 10_000 },
          { method: 'otp', timestamp: NOW - 30 },
        ],
        NOW,
      ),
    ).toBe(true);
  });

  it('rejects a timestamp in the future', () => {
    expect(isFreshRecovery([{ method: 'otp', timestamp: NOW + 600 }], NOW)).toBe(false);
  });

  it('fails closed on the bare string form, which carries no timestamp', () => {
    expect(isFreshRecovery(['otp'], NOW)).toBe(false);
  });

  it.each([undefined, null, 'otp', 42, {}, [null], [{ method: 'otp' }], [{ timestamp: NOW }]])(
    'fails closed on malformed amr: %j',
    (amr) => {
      expect(isFreshRecovery(amr, NOW)).toBe(false);
    },
  );
});
