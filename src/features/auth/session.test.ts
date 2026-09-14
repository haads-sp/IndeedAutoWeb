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

const { getClaims, getUser, rpc } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getClaims, getUser }, rpc }),
}));

import { currentSession } from './session';

const USER_ID = '8a0d1e65-4a01-4f80-9350-7f7e2852511f';

function withClaims(claims: Record<string, unknown> | null) {
  getClaims.mockResolvedValue({ data: claims ? { claims } : null, error: null });
}

function withUser(user: Record<string, unknown> | null, error: unknown = null) {
  getUser.mockResolvedValue({ data: { user }, error });
}

/** The account_is_active() RPC. Active unless a test says otherwise. */
function withAccountActive(active: boolean | null, error: unknown = null) {
  rpc.mockResolvedValue({ data: active, error });
}

beforeEach(() => {
  getClaims.mockReset();
  getUser.mockReset();
  rpc.mockReset();
  withAccountActive(true);
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

  /**
   * Stage 8. Supabase still lets a soft-deleted account sign in, because a soft delete
   * touches profiles.deleted_at and never auth.users. The application must refuse it.
   */
  it('a verified user whose account is soft-deleted is DELETED, not verified', async () => {
    withClaims({ sub: USER_ID });
    withUser({ id: USER_ID, email: 'a@example.com', email_confirmed_at: '2026-09-12T00:00:00Z' });
    withAccountActive(false);

    expect(await currentSession()).toEqual({
      state: 'deleted',
      userId: USER_ID,
      email: 'a@example.com',
    });
    expect(rpc).toHaveBeenCalledWith('account_is_active');
  });

  it('a failure to check the account is anonymous — never "deleted"', async () => {
    // Failing closed matters, but so does not lying: a transient error must not tell
    // someone their account has been deleted.
    withClaims({ sub: USER_ID });
    withUser({ id: USER_ID, email: 'a@example.com', email_confirmed_at: '2026-09-12T00:00:00Z' });
    withAccountActive(null, new Error('network'));

    expect(await currentSession()).toEqual({ state: 'anonymous' });
  });

  it('an unverified user is reported unverified without consulting the account check', async () => {
    withClaims({ sub: USER_ID });
    withUser({ id: USER_ID, email: 'a@example.com', email_confirmed_at: null });

    expect((await currentSession()).state).toBe('unverified');
    expect(rpc).not.toHaveBeenCalled();
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
