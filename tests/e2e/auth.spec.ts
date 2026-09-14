import { expect, test, type Page } from '@playwright/test';

/**
 * The Stage 2–4 gates, as tests that run on every push.
 */

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const haveAccount = Boolean(EMAIL && PASSWORD);

async function signIn(page: Page) {
  await page.goto('/login');
  // Let the page finish loading its scripts before interacting. docs/ISSUES.md row 4: one
  // run clicked "Sign in" and stayed on bare /login for the full 5s — no ?outcome=, so the
  // action never redirected at all, and the server logged no error. The most likely cause
  // is a click landing mid-hydration; this removes that window.
  await page.waitForLoadState('networkidle');

  await page.getByLabel('Email').fill(EMAIL!);
  await page.getByLabel('Password').fill(PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Longer than the 5s default. Sign-in makes three network round trips — the Server
  // Action, Supabase's token endpoint, then /portal's getUser() and profile read — and a
  // cold CI runner can take longer than the default on the first one. The other candidate
  // cause of row 4, so it is addressed too rather than guessed between.
  await expect(page).toHaveURL(/\/portal/, { timeout: 15_000 });
}

test.describe('anonymous access', () => {
  test('/portal redirects a signed-out visitor to /login', async ({ page }) => {
    await page.goto('/portal');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('account deletion is unreachable when signed out', async ({ page }) => {
    await page.goto('/account/delete');
    await expect(page).toHaveURL(/\/login\?next=\/account\/delete/);
  });

  test('/signup is reachable and states the password rule', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
    await expect(page.getByText(/at least 12 characters/i)).toBeVisible();
  });

  test('an invalid confirmation token is rejected, not passed through', async ({ page }) => {
    await page.goto('/auth/confirm?token_hash=not-a-real-token&type=email');
    await expect(page).toHaveURL(/\/verify-email\?state=invalid/);
  });

  test('an open redirect in `next` is refused even with a valid-looking link', async ({ page }) => {
    await page.goto('/auth/confirm?token_hash=x&type=email&next=//example.com');
    // Must land on our own origin, never example.com.
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\//);
  });

  test('a wrong password and an unknown address are indistinguishable', async ({ page }) => {
    // The enumeration property. If these two ever differ, an attacker can test a list of
    // addresses to learn which of your users are users.
    await page.goto('/login');
    await page.getByLabel('Email').fill('definitely-not-registered-9417@example.com');
    await page.getByLabel('Password').fill('some-wrong-password-here');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // NOTE: not getByRole('alert') — Next's route announcer also has role=alert.
    await expect(page.getByText('That email and password do not match.')).toBeVisible();
  });

  /**
   * NOTE: there is deliberately NO spec here that completes a signup.
   *
   * Two reasons, both about side effects rather than difficulty. It would create a real
   * user in the preview Supabase project on every CI run, and preview has no custom SMTP,
   * so Supabase's built-in sender rate-limits at roughly two messages an hour and the
   * spec would fail for reasons unrelated to our code. Probed and confirmed:
   * over_email_send_rate_limit on the second attempt.
   *
   * The identical-response property is verified by the Stage 3 manual gate, which is
   * recorded in docs/DOMAIN.md. What IS covered below is everything that rejects before
   * Supabase is ever called, which has no side effects at all.
   */
  test('a password under the minimum is rejected, without contacting Supabase', async ({ page }) => {
    await page.goto('/signup');
    await page.getByLabel('Email').fill('someone@alsayeed.ca');
    // 11 characters. The form's minLength would normally stop this, so it is removed
    // first — the point is to prove the SERVER rejects it, not the browser.
    await page.getByLabel('Password').evaluate((el: HTMLInputElement) => el.removeAttribute('minlength'));
    await page.getByLabel('Password').fill('elevenchars');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/outcome=password_rejected/);
    // Matched on the distinctive tail: the static form hint also says "at least 12
    // characters", so the shorter phrase matches two elements.
    await expect(page.getByText(/A memorable phrase works well/i)).toBeVisible();
  });

  test('a known-breached password is refused', async ({ page }) => {
    await page.goto('/signup');
    await page.getByLabel('Email').fill('someone@alsayeed.ca');
    // Long enough to pass the length rule, and in every breach corpus there is.
    await page.getByLabel('Password').fill('passwordpassword');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/outcome=password_rejected/);
    await expect(page.getByText(/known data breach/i)).toBeVisible();
  });});

test.describe('password reset (anonymous)', () => {
  test('/login links to the reset flow', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  });

  test('requesting a reset says the same thing for an address with no account', async ({ page }) => {
    // Side-effect free: no account exists for this address, so no email is sent. The point
    // is that the page gives nothing away — it must read exactly as it would for a real one.
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill(`no-account-${Date.now()}@example.com`);
    await page.getByRole('button', { name: 'Send reset link' }).click();

    await expect(page).toHaveURL(/\/forgot-password\?outcome=sent/);
    await expect(page.getByText('If an account exists for that address')).toBeVisible();
  });

  test('a used or expired RESET link returns to the reset flow, not to signup', async ({ page }) => {
    // Before this, every failed link landed on /verify-email, which told a user with a
    // perfectly good account to "sign up again with the same address".
    await page.goto('/auth/confirm?token_hash=already-used-or-expired&type=recovery&next=/reset-password');
    await expect(page).toHaveURL(/\/forgot-password\?outcome=link_expired/);
    await expect(page.getByText(/expired or has already been used/i)).toBeVisible();
    await expect(page.getByText(/sign up again/i)).toHaveCount(0);
  });

  test('the reset form is unreachable without a recovery session', async ({ page }) => {
    await page.goto('/reset-password');
    await expect(page).toHaveURL(/\/forgot-password\?outcome=link_expired/);
  });
});

test.describe('signed in', () => {
  test.skip(!haveAccount, 'E2E_EMAIL and E2E_PASSWORD are not set');

  test('sign in, reload, and the session survives', async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Portal' })).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(/\/portal/);
    await expect(page.getByRole('heading', { name: 'Portal' })).toBeVisible();
  });

  /**
   * docs/ISSUES.md row 2. This is the assertion that did not exist when session cookies
   * shipped to production with no HttpOnly and no Secure.
   */
  test('session cookies are HttpOnly, SameSite=Lax, and path-scoped to the app', async ({
    page,
    context,
  }) => {
    await signIn(page);

    const sessionCookies = (await context.cookies()).filter((c) => c.name.startsWith('sb-'));
    expect(sessionCookies.length).toBeGreaterThan(0);

    for (const cookie of sessionCookies) {
      expect(cookie.httpOnly, `${cookie.name} must be HttpOnly`).toBe(true);
      expect(cookie.sameSite, `${cookie.name} must be SameSite=Lax`).toBe('Lax');
      expect(cookie.path, `${cookie.name} must be scoped to /`).toBe('/');
      // `secure` is deliberately NOT asserted: these tests run over http on localhost,
      // where a Secure cookie would be dropped and sign-in could not work at all. The
      // unit tests in tests/session-cookie.test.ts cover the https branch.
    }
  });

  test('the session token is unreadable from JavaScript', async ({ page }) => {
    // The property HttpOnly actually buys. Stated as its own test because this, not the
    // flag, is the thing we care about: an XSS bug must not become account takeover.
    await signIn(page);

    const visible = await page.evaluate(() => document.cookie);
    expect(visible).not.toContain('sb-');
  });

  test('signing out does not survive a back-button reload', async ({ page }) => {
    await signIn(page);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);

    // The check that catches a sign-out which only cleared the UI.
    await page.goBack();
    await page.reload();
    await expect(page).toHaveURL(/\/login/);
  });

  test('the own-profile update policy works, and survives a reload', async ({ page }) => {
    // Exercises the `profiles_update_own` RLS policy end to end. docs/ACCESS-CONTROL.md
    // grants "own profile row: Read, update"; a permission nothing exercises is a
    // permission nobody has tested.
    await signIn(page);

    const name = `e2e-${Date.now()}`;
    await page.getByPlaceholder('Display name').fill(name);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('status')).toHaveText('Saved.');

    // Read back from the database, not from the form's own state.
    await page.reload();
    await expect(page.getByPlaceholder('Display name')).toHaveValue(name);
  });

  /**
   * The threat isFreshRecovery() exists for, end to end: someone at an unlocked computer
   * that is signed in with a PASSWORD. They have a perfectly valid session, and they must
   * still not be able to set a new password without proving control of the inbox.
   */
  test('a PASSWORD session cannot use the reset form', async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Portal' })).toBeVisible();

    await page.goto('/reset-password');
    await expect(page).toHaveURL(/\/forgot-password\?outcome=link_expired/);
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toHaveCount(0);
  });

  /**
   * Stage 8. ONLY the refusal paths are tested here. Actually deleting the shared E2E
   * account would break every later run, and a completed deletion is verified by the
   * Stage 8 gate against a real account, with the row shown in the database.
   */
  test('a WRONG password on the delete form deletes nothing', async ({ page }) => {
    await signIn(page);
    await page.goto('/account/delete');

    await page.getByLabel('Current password').fill('definitely-not-the-password');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Delete my account' }).click();

    await expect(page).toHaveURL(/outcome=wrong_password/);
    await expect(page.getByText('Your account has not been deleted.')).toBeVisible();

    // Proven by using the account, not by trusting the message.
    await page.goto('/portal');
    await expect(page.getByRole('heading', { name: 'Portal' })).toBeVisible();
  });

  test('without the confirmation, the server refuses even with the right password', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto('/account/delete');

    // The checkbox is `required` in the browser. Removed here, because the point is that the
    // SERVER refuses — an attacker does not use our form.
    await page.getByRole('checkbox').evaluate((el: HTMLInputElement) => el.removeAttribute('required'));
    await page.getByLabel('Current password').fill(PASSWORD!);
    await page.getByRole('button', { name: 'Delete my account' }).click();

    await expect(page).toHaveURL(/outcome=not_confirmed/);
    await page.goto('/portal');
    await expect(page.getByRole('heading', { name: 'Portal' })).toBeVisible();
  });

  test('a signed-out browser cannot reach the portal at all', async ({ browser }) => {
    // Weaker than Stage 6's gate, which needs a real SECOND user querying the first
    // user's row directly. This is an early tripwire, not a substitute for it.
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();

    await anonPage.goto('/portal');
    await expect(anonPage).toHaveURL(/\/login/);
    await expect(anonPage.getByRole('heading', { name: 'Portal' })).toHaveCount(0);

    await anon.close();
  });

  /**
   * NOT COVERED HERE: the "signed in but unverified" redirect.
   *
   * BUILD-PLAN.md §7 calls that column "the one that gets skipped", so its absence is
   * worth stating rather than leaving to be noticed. Creating an unverified user from a
   * test means completing a real signup, which creates a permanent user in the preview
   * project on every run and hits Supabase's built-in email rate limit — the same reason
   * there is no signup spec above.
   *
   * It is covered by the Stage 5 manual gate instead, which is recorded in docs/ISSUES.md.
   * The logic it depends on is `currentSession()`, which reads `email_confirmed_at` from
   * auth.users rather than the forgeable `user_metadata.email_verified`.
   */
});
