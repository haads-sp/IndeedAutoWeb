#!/usr/bin/env node
/**
 * Proves a revoked session is dead at EVERY layer — not just at the route.
 *
 * BUILD-PLAN.md Stage 7 gate: "an old session confirmed dead afterwards."
 *
 * Supabase's docs: "Access Tokens of revoked sessions remain valid until their expiry
 * time." So signing out does NOT invalidate a token already issued. The application sees
 * the session as dead (getUser() asks the Auth server), but PostgREST only checks the
 * JWT's signature and expiry — a stolen token would keep reading data for up to an hour.
 * The migration 20260914043017_session_revocation.sql closes that in RLS. This script is
 * how you know it worked.
 *
 * It simulates two devices signed in to one account, signs out GLOBALLY from device 2 —
 * exactly what a password reset does — then tries to use device 1's still-unexpired token
 * against the Auth server, the Data API, and the refresh endpoint.
 *
 * ⚠️  THIS SIGNS THE ACCOUNT OUT OF EVERY DEVICE. Use a test account, not the one you use.
 *
 * Usage (PowerShell). Credentials come from the environment and are never printed:
 *
 *   $env:SUPABASE_URL = "https://<ref>.supabase.co"
 *   $env:SUPABASE_PUBLISHABLE_KEY = "sb_publishable_..."
 *   $env:USER_EMAIL = "test-account@example.com"
 *   $env:USER_PASSWORD = "..."
 *   node scripts/session-revocation-check.mjs
 */

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const EMAIL = process.env.USER_EMAIL;
const PASSWORD = process.env.USER_PASSWORD;

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

function mask(email) {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

/**
 * Masks every email address in a string before it is printed.
 *
 * mask() alone covered only the header line. Response bodies were printed raw, and
 * GET /auth/v1/user returns the account's full address — so the output this script
 * describes as safe to paste into a chat or an issue contained the unmasked email.
 * Every body goes through this now.
 */
function redact(text) {
  return text.replace(
    /([A-Za-z0-9._%+-]{1,2})[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    '$1***@$2',
  );
}

function rowsOf(body) {
  try {
    const parsed = JSON.parse(body || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function signIn() {
  const response = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) {
    throw new Error(`sign-in failed for ${mask(EMAIL)}: ${response.status} ${JSON.stringify(body)}`);
  }
  const claims = JSON.parse(Buffer.from(body.access_token.split('.')[1], 'base64url').toString());
  return {
    token: body.access_token,
    refresh: body.refresh_token,
    userId: body.user.id,
    sessionId: claims.session_id,
    exp: claims.exp,
  };
}

async function call(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${URL_}${path}`, {
    method,
    headers: {
      apikey: KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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

async function main() {
  console.log('Stage 7 - session revocation check');
  console.log(`project:  ${URL_}`);
  console.log(`account:  ${mask(EMAIL)}`);

  const device1 = await signIn();
  const device2 = await signIn();

  if (device1.sessionId === device2.sessionId) {
    console.error('\nBoth sign-ins produced the same session. The check would prove nothing.');
    process.exit(2);
  }

  const secondsLeft = device1.exp - Math.floor(Date.now() / 1000);
  console.log(`\ndevice 1 session: ${device1.sessionId}`);
  console.log(`device 2 session: ${device2.sessionId}`);
  console.log(`device 1 token still has ${secondsLeft}s before its JWT expires`);

  // ---- Before revocation: device 1 is genuinely alive. Without these, every "dead"
  //      result below could just mean the checks never worked.
  const ownPath = `/rest/v1/profiles?id=eq.${device1.userId}&select=id`;

  const beforeData = await call(ownPath, { token: device1.token });
  report(
    'CONTROL - before revocation, device 1 reads its own profile',
    `GET ${ownPath}   (device 1)`,
    beforeData,
    'exactly one row',
    beforeData.status === 200 && rowsOf(beforeData.body).length === 1,
  );

  const beforeAuth = await call('/auth/v1/user', { token: device1.token });
  report(
    'CONTROL - before revocation, the Auth server accepts device 1',
    'GET /auth/v1/user   (device 1)',
    beforeAuth,
    '200',
    beforeAuth.status === 200,
  );

  // ---- Revoke every session, from the OTHER device, the way a password reset does.
  const logout = await call('/auth/v1/logout?scope=global', { token: device2.token, method: 'POST' });
  report(
    'device 2 signs out GLOBALLY (what a password reset does)',
    'POST /auth/v1/logout?scope=global   (device 2)',
    logout,
    '204',
    logout.status === 204,
  );

  // ---- After revocation. Device 1's JWT has NOT expired; only its session was revoked.
  const afterAuth = await call('/auth/v1/user', { token: device1.token });
  report(
    "AFTER - the Auth server rejects device 1's unexpired token",
    'GET /auth/v1/user   (device 1)',
    afterAuth,
    '401 or 403 (session not found)',
    afterAuth.status === 401 || afterAuth.status === 403,
  );

  // THE ONE THAT MATTERS. Before the migration, this returned the row.
  const afterData = await call(ownPath, { token: device1.token });
  report(
    "AFTER - THE DATA API refuses device 1's unexpired token",
    `GET ${ownPath}   (device 1)`,
    afterData,
    'zero rows - without the session_is_active() policy this returns the row',
    afterData.status === 200 && rowsOf(afterData.body).length === 0,
  );

  const afterWrite = await call(`/rest/v1/profiles?id=eq.${device1.userId}`, {
    token: device1.token,
    method: 'PATCH',
    body: { display_name: 'written-after-revocation' },
  });
  report(
    'AFTER - device 1 cannot write with its unexpired token either',
    `PATCH /rest/v1/profiles?id=eq.${device1.userId}   (device 1)`,
    afterWrite,
    'zero rows affected',
    rowsOf(afterWrite.body).length === 0,
  );

  const afterRefresh = await call('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: { refresh_token: device1.refresh },
  });
  report(
    "AFTER - device 1 cannot mint a new token from its refresh token",
    'POST /auth/v1/token?grant_type=refresh_token   (device 1)',
    afterRefresh,
    'refused',
    afterRefresh.status >= 400,
  );

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${'-'.repeat(64)}`);
  console.log(failed === 0 ? `ALL ${results.length} CHECKS PASSED` : `${failed} CHECK(S) FAILED`);
  console.log('\nThis account is now signed out everywhere. Sign in again to use it.');
  return failed === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`\nERROR: ${error.message}`);
    process.exit(2);
  },
);
