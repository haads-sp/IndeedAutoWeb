import { expect, test } from '@playwright/test';

import { haveAccount, recordCspViolations, signIn } from './helpers';

/**
 * The Stage 10 gates that do not need production: security headers, the Content-Security-
 * Policy, CORS and CSRF, run against the built app on every push.
 *
 * Every check reads the RESPONSE or the BROWSER, never the config that is supposed to produce
 * it. A header set in next.config.ts that a later change silently stops sending is exactly
 * what these exist to catch.
 */

const EVIL_ORIGIN = 'https://evil.example';

function nonceOf(policy: string | undefined): string | null {
  return policy?.match(/'nonce-([^']+)'/)?.[1] ?? null;
}

test.describe('security headers', () => {
  test('every page carries the static security headers, and no framework fingerprint', async ({ request }) => {
    const headers = (await request.get('/login')).headers();

    expect(headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('API responses get the strictest policy there is, and the same static headers', async ({ request }) => {
    const headers = (await request.get('/api/version')).headers();

    expect(headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
  });

  test('an unknown page is a friendly 404 that reveals nothing', async ({ page }) => {
    const response = await page.goto('/definitely-not-a-page');

    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });
});

test.describe('Content-Security-Policy', () => {
  test('a fresh nonce on every request, stamped on every script the page ships', async ({ request }) => {
    const first = await request.get('/login');
    const second = await request.get('/login');

    const nonce = nonceOf(first.headers()['content-security-policy']);
    expect(nonce).toBeTruthy();
    expect(nonceOf(second.headers()['content-security-policy'])).not.toBe(nonce);

    // A script without this response's nonce is blocked by the browser, so every one must have it.
    const scripts = (await first.text()).match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) {
      expect(tag).toContain(`nonce="${nonce}"`);
    }
  });

  test('pages load and hydrate with no violations, and an injected script is blocked', async ({ page }) => {
    const violations = await recordCspViolations(page);

    for (const path of [
      '/',
      '/terms',
      '/privacy',
      '/data-deletion',
      '/login',
      '/signup',
      '/forgot-password',
      '/verify-email',
      '/auth/confirm?token_hash=abc123&type=email',
      '/definitely-not-a-page',
    ]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      // Proof the page's own scripts RAN, not merely that nothing complained: Next's inline
      // bootstrap script defines this. A policy that blocked every script, with a detector that
      // failed to notice, would otherwise pass.
      const bootstrapped = await page.evaluate(() => Array.isArray((window as { __next_f?: unknown }).__next_f));
      expect(bootstrapped, `${path}: the page's own scripts ran`).toBe(true);
      expect(await violations(), `${path}: no CSP violations`).toEqual([]);
    }

    // The control: the policy and the detector both work. The server's real HTML is given what a
    // stored XSS would add (markup with no nonce) and delivered under the real response headers.
    //
    // NOT page.addScriptTag(): Playwright inserts that through the DevTools protocol, which
    // Chromium exempts from the page's CSP, so it runs whatever the policy says. Verified: it
    // did, on a page whose response carried the policy.
    await page.route('**/login', async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        '</body>',
        '<script>window.__injected = true;</script>' +
          '<img src="/injected-probe" onerror="window.__injectedHandler = true"></body>',
      );
      await route.fulfill({ response, body });
    });
    const intercepted = await page.goto('/login');
    await page.waitForLoadState('networkidle');

    expect(intercepted?.headers()['content-security-policy']).toContain("'strict-dynamic'");
    const injected = await page.evaluate(() => {
      const w = window as { __injected?: boolean; __injectedHandler?: boolean; __next_f?: unknown };
      return { script: w.__injected, handler: w.__injectedHandler, own: Array.isArray(w.__next_f) };
    });
    expect(injected, 'the injected script and handler did not run; the page\'s own scripts did').toEqual({
      script: undefined,
      handler: undefined,
      own: true,
    });
    expect((await violations()).join('\n')).toMatch(/script-src/);
  });
});

test.describe('Content-Security-Policy, signed in', () => {
  test.skip(!haveAccount, 'E2E_EMAIL and E2E_PASSWORD are not set');

  test('the portal and the delete page load with no violations', async ({ page }) => {
    const violations = await recordCspViolations(page);

    await signIn(page);
    await page.waitForLoadState('networkidle');
    expect(await violations(), '/portal').toEqual([]);

    await page.goto('/account/delete');
    await page.waitForLoadState('networkidle');
    expect(await violations(), '/account/delete').toEqual([]);
  });
});

test.describe('CORS', () => {
  test('no cross-origin read access is granted, to pages or to the API', async ({ request }) => {
    for (const path of ['/login', '/api/version']) {
      const headers = (await request.get(path, { headers: { Origin: EVIL_ORIGIN } })).headers();
      expect(headers['access-control-allow-origin'], path).toBeUndefined();
      expect(headers['access-control-allow-credentials'], path).toBeUndefined();
    }
  });

  test('a preflight from another origin is not approved', async ({ request }) => {
    const response = await request.fetch('/api/version', {
      method: 'OPTIONS',
      headers: { Origin: EVIL_ORIGIN, 'Access-Control-Request-Method': 'POST' },
    });
    expect(response.headers()['access-control-allow-origin']).toBeUndefined();
  });
});

test.describe('CSRF', () => {
  /**
   * Next.js compares a Server Action's Origin with the Host and aborts on a mismatch. This
   * proves that check is live in the built app rather than trusting that it is.
   *
   * The action used has no side effects on this input: an address that fails our own format
   * check returns before any rate limiter or Supabase call. The same-origin request is the
   * control — without it, a refused cross-site request could just be a malformed one.
   */
  test('a cross-site Server Action is refused; the identical same-origin request runs', async ({
    request,
    baseURL,
  }) => {
    const html = await (await request.get('/forgot-password')).text();
    const actionField = html.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];
    expect(actionField, 'the form renders a Server Action id').toBeTruthy();

    const submit = (origin: string) =>
      request.post('/forgot-password', {
        headers: { Origin: origin },
        multipart: { [actionField!]: '', email: 'not-an-email' },
        maxRedirects: 0,
      });

    const sameOrigin = await submit(baseURL!);
    expect(sameOrigin.status()).toBe(303);
    expect(sameOrigin.headers()['location']).toContain('outcome=invalid_email');

    for (const origin of [EVIL_ORIGIN, 'null']) {
      const refused = await submit(origin);
      expect(refused.status(), `Origin: ${origin}`).toBe(500);
      // No redirect to the outcome page: the action never ran.
      expect(refused.headers()['location'], `Origin: ${origin}`).toBeUndefined();
    }
  });
});
