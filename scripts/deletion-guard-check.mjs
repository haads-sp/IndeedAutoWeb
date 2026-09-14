#!/usr/bin/env node
/**
 * Proves the database refuses account deletion without RECENT re-authentication.
 *
 * soft_delete_own_account() is callable by any signed-in session straight through the
 * Data API — no page, no Server Action. If its re-authentication check did not work,
 * anyone with access to a signed-in browser could delete the account from the console
 * without knowing the password. The application's own password check would be bypassed
 * entirely, because it never runs.
 *
 * The function demands a PASSWORD sign-in within the last 300 seconds. This script signs
 * in, waits past that window with the session otherwise perfectly valid, then calls the
 * function directly — exactly as an attacker at an unlocked machine would.
 *
 * Takes about five and a half minutes. It is supposed to.
 *
 * ⚠️  If the guard is BROKEN, this soft-deletes the account. That is the only way to test
 *     a delete guard honestly. Use a test account, and if it fails, restore it with:
 *       select public.admin_restore_account('<user id printed below>');
 *
 * Usage (PowerShell). Credentials come from the environment and are never printed:
 *
 *   $env:SUPABASE_URL = "https://<ref>.supabase.co"
 *   $env:SUPABASE_PUBLISHABLE_KEY = "sb_publishable_..."
 *   $env:USER_EMAIL = "test-account@example.com"
 *   $env:USER_PASSWORD = "..."
 *   node scripts/deletion-guard-check.mjs
 */

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const EMAIL = process.env.USER_EMAIL;
const PASSWORD = process.env.USER_PASSWORD;

/** Must exceed the 300s window in soft_delete_own_account(), with margin for clock skew. */
const WAIT_SECONDS = 330;

const missing = Object.entries({
  SUPABASE_URL: URL_,
  SUPABASE_PUBLISHABLE_KEY: KEY,
  USER_EMAIL: EMAIL,
  USER_PASSWORD: PASSWORD,
})
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  console.error('See the header of this file for the exact commands.');
  process.exit(2);
}

function redact(text) {
  return text.replace(
    /([A-Za-z0-9._%+-]{1,2})[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    '$1***@$2',
  );
}

async function signIn() {
  const response = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) {
    throw new Error(`sign-in failed: ${response.status} ${redact(JSON.stringify(body))}`);
  }
  const claims = JSON.parse(Buffer.from(body.access_token.split('.')[1], 'base64url').toString());
  return { token: body.access_token, userId: body.user.id, amr: claims.amr, exp: claims.exp };
}

async function rpc(token, fn, args = {}) {
  const response = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  return { status: response.status, body: await response.text() };
}

const results = [];

function report(label, query, result, expectation, ok) {
  console.log(`\n${ok ? 'PASS' : 'FAIL'}  ${label}`);
  console.log(`  query:    ${query}`);
  console.log(`  response: ${result.status} ${redact((result.body || '(empty)').slice(0, 200))}`);
  console.log(`  expected: ${expectation}`);
  results.push(ok);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log('Stage 8 - deletion re-authentication guard');
  console.log(`project: ${URL_}`);

  const session = await signIn();
  console.log(`user id: ${session.userId}`);
  console.log(`amr:     ${JSON.stringify(session.amr)}`);

  const lifetime = session.exp - Math.floor(Date.now() / 1000);
  if (lifetime <= WAIT_SECONDS + 30) {
    console.error(`\nToken expires in ${lifetime}s, before the wait ends. The check would prove nothing.`);
    process.exit(2);
  }

  // CONTROL: the account is active and the session works. Without this, a refusal later
  // could mean the session was simply dead rather than that the guard held.
  const before = await rpc(session.token, 'account_is_active');
  report(
    'CONTROL - the session is valid and the account is active',
    'POST /rest/v1/rpc/account_is_active',
    before,
    'true',
    before.status === 200 && before.body.trim() === 'true',
  );

  console.log(`\nWaiting ${WAIT_SECONDS}s so the password sign-in is older than the 300s window.`);
  console.log('The token itself stays valid throughout — only its sign-in gets old.');
  for (let elapsed = 0; elapsed < WAIT_SECONDS; elapsed += 30) {
    process.stdout.write(`  ${WAIT_SECONDS - elapsed}s remaining...\n`);
    await sleep(Math.min(30, WAIT_SECONDS - elapsed) * 1000);
  }

  // Still valid? If the session died during the wait, the attempt below proves nothing.
  const stillValid = await rpc(session.token, 'account_is_active');
  report(
    'CONTROL - after the wait, the SAME token is still accepted',
    'POST /rest/v1/rpc/account_is_active',
    stillValid,
    'true - so a refusal below is the re-authentication guard, not a dead session',
    stillValid.status === 200 && stillValid.body.trim() === 'true',
  );

  // THE ATTACK: a valid, signed-in session calling the delete function directly, with no
  // fresh password.
  const attempt = await rpc(session.token, 'soft_delete_own_account', {});
  report(
    'THE GUARD - a stale sign-in calls soft_delete_own_account directly',
    'POST /rest/v1/rpc/soft_delete_own_account  (password sign-in > 300s old)',
    attempt,
    'refused with "recent re-authentication required"',
    attempt.status >= 400 && /re-authentication required/i.test(attempt.body),
  );

  const after = await rpc(session.token, 'account_is_active');
  report(
    'the account is STILL active afterwards',
    'POST /rest/v1/rpc/account_is_active',
    after,
    'true - nothing was deleted',
    after.status === 200 && after.body.trim() === 'true',
  );

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${'-'.repeat(64)}`);
  console.log(failed === 0 ? `ALL ${results.length} CHECKS PASSED` : `${failed} CHECK(S) FAILED`);
  if (after.body.trim() !== 'true') {
    console.log(`\nThe account appears deleted. Restore it in the SQL editor with:`);
    console.log(`  select public.admin_restore_account('${session.userId}');`);
  }
  return failed === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`\nERROR: ${error.message}`);
    process.exit(2);
  },
);
