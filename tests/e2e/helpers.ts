import { expect, type Page } from '@playwright/test';

export const EMAIL = process.env.E2E_EMAIL;
export const PASSWORD = process.env.E2E_PASSWORD;
export const haveAccount = Boolean(EMAIL && PASSWORD);

export async function signIn(page: Page) {
  await page.goto('/login');
  // Let the page finish loading its scripts before interacting. docs/ISSUES.md row 4: one
  // run clicked "Sign in" and stayed on bare /login for the full 5s — no ?outcome=, so the
  // action never redirected at all, and the server logged no error. The most likely cause
  // is a click landing mid-hydration; this removes that window.
  await page.waitForLoadState('networkidle');

  await page.getByLabel('Email').fill(EMAIL!);
  await page.getByLabel('Password').fill(PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Wait for the page sign-in LANDS on, never for a URL. docs/ISSUES.md row 9: the router passes
  // through /portal before the portal's gate redirects to /accept-terms, so a URL check saw /portal,
  // concluded nothing needed accepting, and returned while the browser was still on its way to
  // /accept-terms. (A regex like /\/portal/ also matches /accept-terms?next=/portal.) Each of these
  // headings is rendered only by the page it names, so seeing one means the navigation is over.
  //
  // Longer than the 5s default: sign-in is several network round trips, and a cold CI runner can
  // take longer than the default on the first one (docs/ISSUES.md row 4).
  const portal = page.getByRole('heading', { name: 'Portal', exact: true });
  const acceptance = page.getByRole('heading', { name: 'Before you continue', exact: true });
  await expect(portal.or(acceptance)).toBeVisible({ timeout: 15_000 });

  // Stage 11. An account that has not accepted the CURRENT policy versions is stopped at
  // /accept-terms. The E2E account meets it once per new version, and accepts as a person would.
  // Acceptance is recorded in the preview database, so later runs go straight to /portal.
  // tests/e2e/public.spec.ts asserts the record is then shown.
  if (await acceptance.isVisible()) {
    await page.waitForLoadState('networkidle');
    await page.getByRole('checkbox', { name: /I have read and agree/ }).check();
    await page.getByRole('button', { name: 'Agree and continue' }).click();
    await expect(portal).toBeVisible({ timeout: 15_000 });
  }

  await expect(page).toHaveURL((url) => url.pathname === '/portal');
}

type CspWindow = Window & { __cspViolations?: string[] };

/**
 * Records Content-Security-Policy violations on `page`. Call BEFORE navigating.
 *
 * Two independent detectors, because either alone can miss one: the browser's own
 * `securitypolicyviolation` event (installed before any page script runs), and Chromium's
 * console report. Returns a function that reads what the CURRENT document has recorded.
 */
export async function recordCspViolations(page: Page): Promise<() => Promise<string[]>> {
  const fromConsole: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) fromConsole.push(message.text());
  });

  await page.addInitScript(() => {
    const w = window as CspWindow;
    w.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      w.__cspViolations!.push(`${event.effectiveDirective} blocked ${event.blockedURI || 'inline'}`);
    });
  });

  return async () => {
    const fromEvents = await page.evaluate(() => (window as CspWindow).__cspViolations ?? []);
    return [...fromEvents, ...fromConsole.splice(0)];
  };
}
