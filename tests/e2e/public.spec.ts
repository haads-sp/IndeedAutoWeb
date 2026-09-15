import { expect, test } from '@playwright/test';

import { haveAccount, signIn } from './helpers';

/**
 * Stage 11: the public face, and the consent plumbing behind it.
 */

const POLICY_PAGES = [
  { path: '/terms', title: 'Terms of Service' },
  { path: '/privacy', title: 'Privacy Policy' },
  { path: '/data-deletion', title: 'Data Deletion Policy' },
];

test.describe('landing page', () => {
  test('offers signing up and signing in, and links every policy', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle('alsayeed.ca');
    await expect(page.getByRole('heading', { level: 1, name: 'alsayeed.ca' })).toBeVisible();

    const account = page.getByRole('navigation', { name: 'Account' });
    await expect(account.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/signup');
    await expect(account.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');

    const policies = page.getByRole('navigation', { name: 'Policies' });
    for (const { path, title } of POLICY_PAGES) {
      await expect(policies.getByRole('link', { name: title })).toHaveAttribute('href', path);
    }
  });
});

test.describe('policy pages', () => {
  for (const { path, title } of POLICY_PAGES) {
    test(`${path} is a placeholder, visibly marked for review by a lawyer`, async ({ page }) => {
      const response = await page.goto(path);

      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(`${title} · alsayeed.ca`);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

      // BUILD-PLAN.md Stage 11. If this fails, someone replaced the placeholder: make sure a
      // lawyer reviewed the text, and bump the version in src/features/legal/policies.ts.
      const notice = page.getByRole('note', { name: 'Placeholder notice' });
      await expect(notice).toContainText('TODO: requires review by a lawyer');
      await expect(page.getByText(/^Version .+-placeholder$/)).toBeVisible();
    });
  }
});

test.describe('robots.txt and llms.txt', () => {
  test('robots.txt keeps a non-production build out of search engines entirely', async ({ request }) => {
    // The E2E build is not production. The production rules are unit-tested in
    // src/app/public-face.test.ts, and checked against the live site in the Stage 11 report.
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);
    expect(await response.text()).toMatch(/User-Agent: \*\s+Disallow: \/\s*$/);
  });

  test('llms.txt describes the site and links its public pages with absolute URLs', async ({ request }) => {
    const response = await request.get('/llms.txt');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/plain');

    const text = await response.text();
    expect(text.startsWith('# alsayeed.ca\n')).toBe(true);
    for (const path of ['/signup', '/login', ...POLICY_PAGES.map((p) => p.path)]) {
      expect(text).toMatch(new RegExp(`\\]\\(https?://[^)]+${path}\\)`));
    }
    expect(text).not.toContain('/portal');
  });
});

test.describe('protected routes refuse with a real redirect', () => {
  /**
   * docs/ISSUES.md row 8. Stage 10's loading states made every one of these answer a signed-out
   * request with 200: the loading skeleton plus a <meta http-equiv="refresh">. Browsers followed
   * the refresh, so every browser-level spec still passed. Only the raw response shows it.
   */
  for (const [path, location] of [
    ['/portal', '/login?next=/portal'],
    ['/account/delete', '/login?next=/account/delete'],
    ['/accept-terms', '/login?next=/accept-terms'],
    ['/reset-password', '/forgot-password?outcome=link_expired'],
  ]) {
    test(`a signed-out request for ${path} gets 307, not a 200 that refreshes`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });

      expect(response.status()).toBe(307);
      expect(response.headers()['location']).toBe(location);
    });
  }
});

test.describe('consent, signed in', () => {
  test.skip(!haveAccount, 'E2E_EMAIL and E2E_PASSWORD are not set');

  test('the portal shows the acceptance read back from the database', async ({ page }) => {
    // signIn() accepts on /accept-terms if this account has not accepted the current versions.
    await signIn(page);

    for (const title of ['Terms of Service', 'Privacy Policy']) {
      const row = page.getByRole('term').filter({ hasText: title });
      await expect(row).toBeVisible();
      // The <dd> after it: a version and a date, never "Not recorded".
      await expect(row.locator('xpath=following-sibling::dd[1]')).toHaveText(
        /^Version .+-placeholder, accepted \d{4}-\d{2}-\d{2}$/,
      );
    }
  });

  test('an account that has accepted the current versions is not asked again', async ({ page }) => {
    await signIn(page);

    await page.goto('/accept-terms?next=/portal');
    await expect(page).toHaveURL(/\/portal$/);
  });
});
