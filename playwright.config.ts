import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests.
 *
 * These exist because of docs/ISSUES.md row 2: session cookies shipped to production
 * without HttpOnly, every automated check passed, and the Stage 4 browser gate passed too
 * — because that gate was six manual steps a human performed once and never again.
 *
 * The manual gates from Stages 2 to 4 are reproduced here so they run on every push. The
 * point is not to save clicks; it is that a check performed once is not a check.
 *
 * **These run against a locally built app pointed at the PREVIEW Supabase project**, never
 * production. A test suite that signs in, writes rows and deliberately trips rate limits
 * has no business touching real user data.
 */

const PORT = 3210;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  // Auth flows are stateful and share one account; parallel runs would fight over the
  // session and over the rate-limit counters.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // A test that fails and then passes on retry FAILS THE RUN. Retries stay on so a flake
  // produces a trace and a screenshot to diagnose, but they no longer turn it green.
  // Without this, Playwright reports "1 flaky" as a GitHub notice while the workflow
  // shows success — flakiness recorded somewhere nobody reads, which is how a suite rots
  // into one people learn to ignore. See docs/ISSUES.md row 4.
  failOnFlakyTests: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // The real production build, not `next dev`. Cookie behaviour, caching and the proxy
    // all differ between the two, and it is the built artefact we ship.
    command: `npm run build && npx next start -p ${PORT}`,
    url: `${baseURL}/api/version`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
