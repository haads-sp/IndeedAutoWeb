#!/usr/bin/env node
/**
 * The Stage 6 gate, as a runnable script.
 *
 * BUILD-PLAN.md Stage 6: "sign in as a second real user and query the first user's row
 * directly from the client with the publishable key. It must return zero rows. Show me
 * the query and the actual result. A passing unit test is not this gate."
 *
 * So this uses no test doubles and no mocks. It signs in as two real users against a real
 * project with the publishable key — exactly what a browser holds — and tries to read and
 * write the other user's row.
 *
 * It prints every request and its actual response, because the gate asks for the query
 * and the result, not for a verdict.
 *
 * Usage (PowerShell). Credentials come from the environment and are never printed:
 *
 *   $env:SUPABASE_URL = "https://<ref>.supabase.co"
 *   $env:SUPABASE_PUBLISHABLE_KEY = "sb_publishable_..."
 *   $env:USER_A_EMAIL = "first@example.com";  $env:USER_A_PASSWORD = "..."
 *   $env:USER_B_EMAIL = "second@example.com"; $env:USER_B_PASSWORD = "..."
 *   node scripts/rls-check.mjs
 *
 * Exits 0 only if every isolation check holds.
 */

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const A_EMAIL = process.env.USER_A_EMAIL;
const A_PASSWORD = process.env.USER_A_PASSWORD;
const B_EMAIL = process.env.USER_B_EMAIL;
const B_PASSWORD = process.env.USER_B_PASSWORD;

const missing = Object.entries({
  SUPABASE_URL: URL_,
  SUPABASE_PUBLISHABLE_KEY: KEY,
  USER_A_EMAIL: A_EMAIL,
  USER_A_PASSWORD: A_PASSWORD,
  USER_B_EMAIL: B_EMAIL,
  USER_B_PASSWORD: B_PASSWORD,
})
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  console.error('See the header of this file for the exact commands.');
  process.exit(2);
}

/** Masks an address so the transcript can be pasted into a chat or an issue. */
function mask(email) {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

/**
 * Masks every email address in a string before it is printed. This script's queries do not
 * currently return addresses, but the sister script's did, and a response body is not a
 * place to assume nothing personal will ever appear.
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

async function signIn(email, password) {
  const response = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const body = await response.json();
  if (!response.ok || !body.access_token) {
    throw new Error(
      `sign-in failed for ${mask(email)}: ${response.status} ${JSON.stringify(body)}`,
    );
  }
  return { token: body.access_token, userId: body.user.id };
}

/** A PostgREST request made exactly as a browser would: publishable key plus the user's JWT. */
async function asUser(token, path, init = {}) {
  const response = await fetch(`${URL_}${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Return affected rows, so "denied" is distinguishable from "succeeded, changed
      // nothing". Without this a blocked UPDATE returns 204 and reads as success.
      // See docs/DOMAIN.md.
      Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  });

  return { status: response.status, body: await response.text() };
}

const results = [];

function report(label, query, result, expectation, ok) {
  console.log(`\n${ok ? 'PASS' : 'FAIL'}  ${label}`);
  console.log(`  query:    ${query}`);
  console.log(`  response: ${result.status} ${redact(result.body || '(empty)')}`);
  console.log(`  expected: ${expectation}`);
  results.push(ok);
}

async function main() {
  console.log('Stage 6 - RLS isolation check');
  console.log(`project:  ${URL_}`);
  console.log(`user A:   ${mask(A_EMAIL)}`);
  console.log(`user B:   ${mask(B_EMAIL)}`);

  const a = await signIn(A_EMAIL, A_PASSWORD);
  const b = await signIn(B_EMAIL, B_PASSWORD);

  if (a.userId === b.userId) {
    console.error('\nBoth sets of credentials are the same account. This would prove nothing.');
    process.exit(2);
  }

  console.log(`\nuser A id: ${a.userId}`);
  console.log(`user B id: ${b.userId}`);

  // CONTROL. If A cannot see A's own row, every "zero rows" below is meaningless —
  // it would only mean the table is empty.
  const own = await asUser(a.token, `/rest/v1/profiles?id=eq.${a.userId}&select=id,display_name`);
  report(
    'CONTROL - user A reads their own row',
    `GET /rest/v1/profiles?id=eq.${a.userId}   (as A)`,
    own,
    'exactly one row, or every check below is vacuous',
    own.status === 200 && rowsOf(own.body).length === 1,
  );

  // THE GATE.
  const cross = await asUser(b.token, `/rest/v1/profiles?id=eq.${a.userId}&select=id,display_name`);
  report(
    "THE GATE - user B reads user A's row by id",
    `GET /rest/v1/profiles?id=eq.${a.userId}   (as B)`,
    cross,
    'zero rows',
    cross.status === 200 && rowsOf(cross.body).length === 0,
  );

  // Enumeration: B listing the whole table must see only itself.
  const all = await asUser(b.token, '/rest/v1/profiles?select=id');
  const allRows = rowsOf(all.body);
  report(
    'user B lists the entire table',
    'GET /rest/v1/profiles?select=id   (as B)',
    all,
    "exactly one row, B's own",
    allRows.length === 1 && allRows[0]?.id === b.userId,
  );

  // Writes across the boundary.
  const write = await asUser(b.token, `/rest/v1/profiles?id=eq.${a.userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ display_name: 'written-by-user-b' }),
  });
  report(
    "user B updates user A's row",
    `PATCH /rest/v1/profiles?id=eq.${a.userId}   (as B)`,
    write,
    'zero rows affected',
    rowsOf(write.body).length === 0,
  );

  const del = await asUser(b.token, `/rest/v1/profiles?id=eq.${a.userId}`, { method: 'DELETE' });
  report(
    "user B deletes user A's row",
    `DELETE /rest/v1/profiles?id=eq.${a.userId}   (as B)`,
    del,
    'refused, or zero rows affected',
    del.status === 401 || del.status === 403 || rowsOf(del.body).length === 0,
  );

  // P5: user-initiated deletion is a SOFT delete, so no client may issue a real DELETE —
  // not even against its own row.
  const delOwn = await asUser(b.token, `/rest/v1/profiles?id=eq.${b.userId}`, { method: 'DELETE' });
  report(
    'user B deletes their OWN row (P5 - must still be refused)',
    `DELETE /rest/v1/profiles?id=eq.${b.userId}   (as B)`,
    delOwn,
    'refused, or zero rows affected - deletion is a soft delete',
    delOwn.status === 401 || delOwn.status === 403 || rowsOf(delOwn.body).length === 0,
  );

  // ---- Stage 8: columns, not just rows.
  //
  // RLS decides WHICH ROWS a user may update. It says nothing about WHICH COLUMNS. With a
  // table-level UPDATE grant, a user may write every column of their own row — including
  // deleted_at. Once deletion reads that column, writing it directly would skip
  // re-authentication and the audit record, and would let a deleted user restore themselves.
  //
  // The probe sets deleted_at to null, which it already is, so deleted_at does not change —
  // though if the write is permitted, the updated_at trigger still bumps that timestamp. It
  // requires UPDATE privilege on the column either way. Observed FAILING before the Stage 8
  // migration (200 with the row) and PASSING after it (403 permission denied).
  const column = await asUser(b.token, `/rest/v1/profiles?id=eq.${b.userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ deleted_at: null }),
  });
  report(
    'user B writes deleted_at on their OWN row directly (Stage 8)',
    `PATCH /rest/v1/profiles?id=eq.${b.userId} {"deleted_at":null}   (as B)`,
    column,
    'refused - only display_name may be written by a client',
    column.status === 401 || column.status === 403,
  );

  // Admin-only functions must not be callable by a signed-in user.
  //
  // Each is called with its REAL parameter names. An earlier version called them with no
  // arguments, and two of the three have required parameters — so PostgREST matched no
  // signature, returned 404, and the check passed WITHOUT EVER REACHING THE PERMISSION
  // CHECK. It would have passed even if user B could call them. Only 401/403 counts now;
  // a 404 means the probe tested nothing, and FAILS.
  //
  // Arguments are chosen so a BROKEN guard would still do no harm:
  //   - purge with a 100-year grace period matches no account
  //   - restore of B's own, non-deleted account updates nothing
  //   - write_audit with an action outside the CHECK constraint cannot insert a row —
  //     and if the guard were broken it would fail with a constraint error (400), which is
  //     distinguishable from, and not counted as, a permission refusal.
  const adminProbes = [
    { fn: 'admin_purge_deleted_accounts', args: { p_older_than: '100 years' } },
    { fn: 'admin_restore_account', args: { p_user_id: b.userId } },
    {
      fn: 'write_audit',
      args: {
        p_action: 'probe.never.valid',
        p_actor: null,
        p_subject: b.userId,
        p_ip: null,
        p_user_agent: null,
      },
    },
  ];

  for (const { fn, args } of adminProbes) {
    const call = await asUser(b.token, `/rest/v1/rpc/${fn}`, {
      method: 'POST',
      body: JSON.stringify(args),
    });
    report(
      `user B calls the admin-only function ${fn}`,
      `POST /rest/v1/rpc/${fn} ${JSON.stringify(args)}   (as B)`,
      call,
      'refused with permission denied - a 404 means the probe missed the function and proves nothing',
      (call.status === 401 || call.status === 403) && /permission denied/i.test(call.body),
    );
  }

  // The audit log is append-only for everyone, and clients may not write it at all.
  const forge = await asUser(b.token, '/rest/v1/audit_log', {
    method: 'POST',
    body: JSON.stringify({ action: 'account.restored', subject_id: b.userId }),
  });
  report(
    'user B forges an audit_log entry (Stage 8)',
    'POST /rest/v1/audit_log   (as B)',
    forge,
    'refused with permission denied - a 404 means the table is missing and proves nothing',
    (forge.status === 401 || forge.status === 403) && /permission denied/i.test(forge.body),
  );

  // And nothing above actually touched A's row.
  const after = await asUser(a.token, `/rest/v1/profiles?id=eq.${a.userId}&select=id,display_name`);
  report(
    "user A's row is intact afterwards",
    `GET /rest/v1/profiles?id=eq.${a.userId}   (as A)`,
    after,
    'one row, display_name NOT "written-by-user-b"',
    rowsOf(after.body).length === 1 && !after.body.includes('written-by-user-b'),
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
