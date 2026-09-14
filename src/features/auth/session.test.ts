import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * currentSession() is the only place that answers "is this user verified" (prohibition P4).
 *
 * Tested with a mocked Supabase client because the "signed in, unverified" state cannot be
 * produced end to end today: with confirmation required, an unconfirmed user gets no
 * session at all, and with confirmation disabled Supabase auto-confirms at signup, which
 * produces a VERIFIED user. See docs/DOMAIN.md. The branching is ours, so the branching
 * is what is tested here.
 *
 * This is not the Stage 6 gate — BUILD-PLAN.md is explicit that "a passing unit test is
 * not this gate", and that gate was run against production with two real users.
 */

const { getClaims, getUser } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getClaims, getUser } }),
}));

import { currentSession } from './session';

const USER_ID = '8a0d1e65-4a01-4f80-9350-7f7e2852511f';

function withClaims(claims: Record<string, unknown> | null) {
  getClaims.mockResolvedValue({ data: claims ? { claims } : null, error: null });
}

function withUser(user: Record<string, unknown> | null, error: unknown = null) {
  getUser.mockResolvedValue({ data: { user }, error });
}

beforeEach(() => {
  getClaims.mockReset();
  getUser.mockReset();
});

describe('currentSession', () => {
  it('no valid session is anonymous, and never calls the Auth server', async () => {
    withClaims(null);

    expect(await currentSession()).toEqual({ state: 'anonymous' });
    // The cheap local check short-circuits: anonymous traffic costs no network round trip.
    expect(getUser).not.toHaveBeenCalled();
  });

  it('a session whose email is confirmed is verified', async () => {
    withClaims({ sub: USER_ID });
    withUser({ id: USER_ID, email: 'a@example.com', email_confirmed_at: '2026-09-12T00:00:00Z' });

    expect(await currentSession()).toEqual({
      state: 'verified',
      userId: USER_ID,
      email: 'a@example.com',
    });
  });

  it('a session whose email is NOT confirmed is unverified, not verified', async () => {
    withClaims({ sub: USER_ID });
    withUser({ id: USER_ID, email: 'a@example.com', email_confirmed_at: null });

    expect((await currentSession()).state).toBe('unverified');
  });

  /**
   * THE FORGERY CASE. docs/DOMAIN.md: user_metadata is writable by the user through
   * updateUser({ data }), and Supabase signs whatever is in it. A token can therefore be
   * perfectly authentic and still claim email_verified: true for an unconfirmed address.
   *
   * If this test ever fails, verification is being read from a field the user controls.
   */
  it('a FORGED user_metadata.email_verified does not make an unconfirmed user verified', async () => {
    withClaims({
      sub: USER_ID,
      user_metadata: { email_verified: true },
    });
    withUser({
      id: USER_ID,
      email: 'a@example.com',
      email_confirmed_at: null,
      user_metadata: { email_verified: true },
    });

    expect((await currentSession()).state).toBe('unverified');
  });

  it('fails closed when the Auth server cannot return the user', async () => {
    // A signature-valid token for a user who has been deleted or banned, or an Auth outage.
    withClaims({ sub: USER_ID });
    withUser(null, new Error('user not found'));

    expect(await currentSession()).toEqual({ state: 'anonymous' });
  });

  it('fails closed when the Auth server returns no user and no error', async () => {
    withClaims({ sub: USER_ID });
    withUser(null);

    expect(await currentSession()).toEqual({ state: 'anonymous' });
  });
});
