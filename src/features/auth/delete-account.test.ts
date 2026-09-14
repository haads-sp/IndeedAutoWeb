import { beforeEach, describe, expect, it, vi } from 'vitest';

const { signInWithPassword, signOut, rpc, currentSession, checkRateLimit } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  rpc: vi.fn(),
  currentSession: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signInWithPassword, signOut }, rpc }),
}));
vi.mock('./session', () => ({ currentSession }));
vi.mock('./rate-limit', () => ({ checkRateLimit }));

import { deleteOwnAccount } from './delete-account';

const USER_ID = 'bf00f5b8-af41-4311-a879-efb5041b1c41';
const EMAIL = 'b@example.com';

const request = (overrides: Partial<Parameters<typeof deleteOwnAccount>[0]> = {}) => ({
  password: 'the-current-password',
  confirmed: true,
  ip: '203.0.113.9',
  userAgent: 'test-agent',
  ...overrides,
});

beforeEach(() => {
  for (const mock of [signInWithPassword, signOut, rpc, currentSession, checkRateLimit]) {
    mock.mockReset();
  }
  currentSession.mockResolvedValue({ state: 'verified', userId: USER_ID, email: EMAIL });
  checkRateLimit.mockResolvedValue({ allowed: true, enforced: true });
  signInWithPassword.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  rpc.mockResolvedValue({ data: true, error: null });
  signOut.mockResolvedValue({ error: null });
});

describe('deleteOwnAccount: the safe default is the reversible branch', () => {
  it('does nothing at all without explicit confirmation', async () => {
    expect(await deleteOwnAccount(request({ confirmed: false }))).toEqual({ outcome: 'not_confirmed' });
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(['anonymous', 'unverified', 'deleted'])('refuses a %s session', async (state) => {
    currentSession.mockResolvedValue({ state, userId: USER_ID, email: EMAIL });
    expect(await deleteOwnAccount(request())).toEqual({ outcome: 'not_signed_in' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a wrong password deletes nothing and signs out nobody', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid login credentials' } });

    expect(await deleteOwnAccount(request())).toEqual({ outcome: 'wrong_password' });
    expect(rpc).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('re-authenticates against the SESSION\'s address, never a supplied one', async () => {
    await deleteOwnAccount(request());
    expect(signInWithPassword).toHaveBeenCalledWith({ email: EMAIL, password: 'the-current-password' });
  });

  it('refuses if the password was verified for a DIFFERENT account', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'someone-else' } }, error: null });

    expect(await deleteOwnAccount(request())).toEqual({ outcome: 'wrong_password' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('charges attempts to the LOGIN budget, so this form is not a second guessing endpoint', async () => {
    await deleteOwnAccount(request());
    expect(checkRateLimit).toHaveBeenCalledWith('login', EMAIL, '203.0.113.9');
  });

  it('when rate limited, never checks the password', async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });

    expect(await deleteOwnAccount(request())).toEqual({ outcome: 'rate_limited', retryAfterSeconds: 60 });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('on success: re-authenticates, THEN marks the account, THEN signs out everywhere', async () => {
    const order: string[] = [];
    signInWithPassword.mockImplementation(async () => {
      order.push('reauth');
      return { data: { user: { id: USER_ID } }, error: null };
    });
    rpc.mockImplementation(async () => {
      order.push('soft_delete');
      return { data: true, error: null };
    });
    signOut.mockImplementation(async () => {
      order.push('sign_out');
      return { error: null };
    });

    expect(await deleteOwnAccount(request())).toEqual({ outcome: 'deleted' });
    expect(order).toEqual(['reauth', 'soft_delete', 'sign_out']);
    expect(rpc).toHaveBeenCalledWith('soft_delete_own_account', {
      p_ip: '203.0.113.9',
      p_user_agent: 'test-agent',
    });
    expect(signOut).toHaveBeenCalledWith({ scope: 'global' });
  });

  it('if the database refuses the deletion, nobody is signed out', async () => {
    // Signing someone out everywhere for a deletion that did not happen punishes them
    // for our error.
    rpc.mockResolvedValue({ data: null, error: { message: 'recent re-authentication required' } });

    expect(await deleteOwnAccount(request())).toEqual({ outcome: 'unavailable' });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('if nothing was marked (already deleted), it is not reported as deleted', async () => {
    rpc.mockResolvedValue({ data: false, error: null });

    expect(await deleteOwnAccount(request())).toEqual({ outcome: 'unavailable' });
    expect(signOut).not.toHaveBeenCalled();
  });
});
