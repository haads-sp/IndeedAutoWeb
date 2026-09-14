#!/usr/bin/env node
/**
 * Proves the audit trail is written — and that each user sees only their own.
 *
 * The Stage 9 audit triggers swallow their own errors, deliberately: an audit failure must
 * never stop someone signing in. The price is that a broken trigger would fail SILENTLY.
 * This script is the thing that notices. It does not trust that rows "should" exist; it
 * signs in, and looks for the row belonging to that exact session.
 *
 * It also exercises the one access-matrix row not yet observed working:
 * "Audit log — signed in, verified: own entries".
 *
 * Usage (PowerShell). Credentials come from the environment and are never printed:
 *
 *   $env:SUPABASE_URL = "https://<ref>.supabase.co"
 *   $env:SUPABASE_PUBLISHABLE_KEY = "sb_publishable_..."
 *   $env:USER_A_EMAIL = "...";  $env:USER_A_PASSWORD = "..."
 *   $env:USER_B_EMAIL = "...";  $env:USER_B_PASSWORD = "..."
 *   node scripts/audit-trail-check.mjs
 */

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const A = { email: process.env.USER_A_EMAIL, password: process.env.USER_A_PASSWORD };
const B = { email: process.env.USER_B_EMAIL, password: process.env.USER_B_PASSWORD };

const missing = Object.entries({
  SUPABASE_URL: URL_,
  SUPABASE_PUBLISHABLE_KEY: KEY,
  USER_A_EMAIL: A.email,
  USER_A_PASSWORD: A.password,
  USER_B_EMAIL: B.email,
  USER_B_PASSWORD: B.password,
})
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exit(2);
}

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

async function signIn({ email, password }) {
  const response = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) {
    throw new Error(`sign-in failed: ${response.status} ${redact(JSON.stringify(body))}`);
  }
  const claims = JSON.parse(Buffer.from(body.access_token.split('.')[1], 'base64url').toString());
  return { token: body.access_token, userId: body.user.id, sessionId: claims.session_id };
}

async function call(token, path, init = {}) {
  const response = await fetch(`${URL_}${path}`, {
    ...init,
    headers: { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  return { status: response.status, body: await response.text() };
}

const results = [];

function report(label, query, result, expectation, ok) {
  console.log(`\n${ok ? 'PASS' : 'FAIL'}  ${label}`);
  console.log(`  query:    ${query}`);
  console.log(`  response: ${result.status} ${redact((result.body || '(empty)').slice(0, 260))}`);
  console.log(`  expected: ${expectation}`);
  results.push(ok);
}

const AUDIT = '/rest/v1/audit_log?select=action,actor_id,subject_id,ip,user_agent,metadata,occurred_at&order=occurred_at.desc';

/** The Auth server commits the session before replying, but give replication a moment. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 1500));

async function main() {
  console.log('Stage 9 - audit trail check');
  console.log(`project: ${URL_}`);

  // ---- 1. A sign-in produces a session_started row for THAT session.
  const b1 = await signIn(B);
  await settle();

  const afterSignIn = await call(b1.token, AUDIT);
  const started = rowsOf(afterSignIn.body).find(
    (r) => r.action === 'auth.session_started' && r.metadata?.session_id === b1.sessionId,
  );
  report(
    "user B's sign-in wrote auth.session_started for that exact session",
    `GET /rest/v1/audit_log   (as B, looking for session ${b1.sessionId})`,
    { status: afterSignIn.status, body: started ? JSON.stringify(started) : afterSignIn.body },
    'a row whose metadata.session_id matches, with actor and subject = B, and ip recorded',
    Boolean(started) &&
      started.actor_id === b1.userId &&
      started.subject_id === b1.userId &&
      started.ip !== null,
  );

  // ---- 2. "Own entries": everything B can see is B's.
  const bRows = rowsOf(afterSignIn.body);
  report(
    'OWN ENTRIES - every audit row user B can read is about user B',
    'GET /rest/v1/audit_log   (as B)',
    { status: afterSignIn.status, body: `${bRows.length} rows; subjects: ${[...new Set(bRows.map((r) => r.subject_id))].join(', ')}` },
    "at least one row, and every subject_id is B's",
    bRows.length > 0 && bRows.every((r) => r.subject_id === b1.userId),
  );

  // ---- 3. Signing out produces session_ended for that session.
  const logout = await call(b1.token, '/auth/v1/logout?scope=local', { method: 'POST' });
  report(
    'user B signs out (this session only)',
    'POST /auth/v1/logout?scope=local   (as B)',
    logout,
    '204',
    logout.status === 204,
  );

  // The old session is revoked, so session_is_active() now hides B's rows from that token.
  // A fresh sign-in is needed to read the result — which also proves the old token cannot.
  await settle();
  const b2 = await signIn(B);
  await settle();

  const afterSignOut = await call(b2.token, AUDIT);
  const ended = rowsOf(afterSignOut.body).find(
    (r) => r.action === 'auth.session_ended' && r.metadata?.session_id === b1.sessionId,
  );
  report(
    "user B's sign-out wrote auth.session_ended for the FIRST session",
    `GET /rest/v1/audit_log   (as B, new session, looking for ${b1.sessionId})`,
    { status: afterSignOut.status, body: ended ? JSON.stringify(ended) : afterSignOut.body },
    'a session_ended row for the signed-out session',
    Boolean(ended) && ended.subject_id === b2.userId,
  );

  const oldToken = await call(b1.token, AUDIT);
  report(
    "the signed-out token can no longer read B's audit trail",
    'GET /rest/v1/audit_log   (as B, REVOKED session)',
    oldToken,
    'zero rows - session_is_active() is false for a signed-out session',
    oldToken.status === 200 && rowsOf(oldToken.body).length === 0,
  );

  // ---- 4. Cross-tenant: A sees none of B's rows.
  const a = await signIn(A);
  await settle();

  const aRows = await call(a.token, AUDIT);
  const aList = rowsOf(aRows.body);
  report(
    "user A cannot see any of user B's audit rows",
    'GET /rest/v1/audit_log   (as A)',
    { status: aRows.status, body: `${aList.length} rows; subjects: ${[...new Set(aList.map((r) => r.subject_id))].join(', ')}` },
    "at least one row (A's own sign-in), and none about B",
    aList.length > 0 && aList.every((r) => r.subject_id === a.userId),
  );

  const aForB = await call(a.token, `/rest/v1/audit_log?subject_id=eq.${b2.userId}&select=action`);
  report(
    "user A asks for user B's audit rows BY ID",
    `GET /rest/v1/audit_log?subject_id=eq.${b2.userId}   (as A)`,
    aForB,
    'zero rows',
    aForB.status === 200 && rowsOf(aForB.body).length === 0,
  );

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${'-'.repeat(64)}`);
  console.log(failed === 0 ? `ALL ${results.length} CHECKS PASSED` : `${failed} CHECK(S) FAILED`);
  return failed === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`\nERROR: ${error.message}`);
    process.exit(2);
  },
);
