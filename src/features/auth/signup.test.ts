import { beforeEach, describe, expect, it, vi } from 'vitest';

const { supabaseSignUp, checkRateLimit, validatePassword } = vi.hoisted(() => ({
  supabaseSignUp: vi.fn(),
  checkRateLimit: vi.fn(),
  validatePassword: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signUp: supabaseSignUp } }),
}));
vi.mock('./rate-limit', () => ({ checkRateLimit }));
vi.mock('@/lib/env/site-url', () => ({
  absoluteUrl: (path: string) => `https://www.alsayeed.ca${path}`,
}));
// Keep the real, pure shape check and copy; replace only the network-bound breach lookup.
vi.mock('./password', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./password')>()),
  validatePassword,
}));

import { signUp } from './signup';

const GOOD_PASSWORD = 'a-perfectly-fine-passphrase';

beforeEach(() => {
  supabaseSignUp.mockReset();
  checkRateLimit.mockReset();
  validatePassword.mockReset();
  checkRateLimit.mockResolvedValue({ allowed: true, enforced: true });
  validatePassword.mockResolvedValue({ ok: true, breachCheckSkipped: false });
  supabaseSignUp.mockResolvedValue({ data: {}, error: null });
});

describe('signup: identical response whether or not the address has an account', () => {
  it('a normal signup is verification_sent', async () => {
    expect(await signUp('a@example.com', GOOD_PASSWORD, null)).toEqual({ outcome: 'verification_sent' });
  });

  /**
   * docs/ISSUES.md row 6 — THE ORACLE. Observed on preview: a second quick signup returned
   * 200 for an existing CONFIRMED address (Supabase sends that account no email, so it never
   * hits the per-address cooldown) and 429 over_email_send_rate_limit for a fresh one.
   * Surfacing the 429 as "too many attempts" told an attacker which addresses have accounts.
   */
  it("Supabase's 429 is the SAME outcome as success, not rate_limited", async () => {
    supabaseSignUp.mockResolvedValue({
      data: null,
      error: { status: 429, message: 'email rate limit exceeded', code: 'over_email_send_rate_limit' },
    });

    expect(await signUp('a@example.com', GOOD_PASSWORD, null)).toEqual({ outcome: 'verification_sent' });
  });

  it('"already registered" is the SAME outcome as success', async () => {
    supabaseSignUp.mockResolvedValue({
      data: null,
      error: { status: 400, message: 'User already registered' },
    });

    expect(await signUp('a@example.com', GOOD_PASSWORD, null)).toEqual({ outcome: 'verification_sent' });
  });
});

describe('signup rate limiting', () => {
  it('OUR limit is surfaced, and stops the request before the breach check and Supabase', async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 90 });

    expect(await signUp('a@example.com', GOOD_PASSWORD, '203.0.113.9')).toEqual({
      outcome: 'rate_limited',
      retryAfterSeconds: 90,
    });
    expect(validatePassword).not.toHaveBeenCalled();
    expect(supabaseSignUp).not.toHaveBeenCalled();
  });

  it('uses the signup policy, keyed on the normalised typed address and the IP', async () => {
    await signUp('  A@Example.COM ', GOOD_PASSWORD, '203.0.113.9');
    expect(checkRateLimit).toHaveBeenCalledWith('signup', 'a@example.com', '203.0.113.9');
  });

  it('a too-short password is rejected WITHOUT spending a rate-limit attempt', async () => {
    const result = await signUp('a@example.com', 'short', null);

    expect(result.outcome).toBe('password_rejected');
    // Correcting a typo must not burn the user's attempts.
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it('a malformed address spends no attempt either', async () => {
    expect(await signUp('not-an-email', GOOD_PASSWORD, null)).toEqual({ outcome: 'invalid_email' });
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});
