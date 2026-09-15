# Access control

This matrix is reproduced verbatim from `docs/BUILD-PLAN.md` §7. It is the specification, not a
summary of the implementation. What is actually enforced, and by what, is in the Status section below.

**Every row must be an RLS policy, not only a route guard.**

| Resource | Anonymous | Signed in, unverified | Signed in, verified | Admin |
|---|---|---|---|---|
| Landing, legal pages | Read | Read | Read | Read |
| Signup, login, reset | Use | Redirect to portal | Redirect to portal | Redirect |
| Verification pending page | Redirect to login | Read | Redirect to portal | Read |
| `/portal` | Redirect to login | Redirect to pending | Read | Read |
| Own profile row | — | Read, update | Read, update | Read, update |
| Any other profile row | — | — | — | Read only, logged |
| Audit log | — | — | Own entries | All |
| Admin routes | — | — | — | Read |

The "signed in, unverified" column is the one that gets skipped. A user who signed up but never
clicked the link has a valid session and is not a verified user. Any check that tests only for the
presence of a session lets them through.

---

## Status

As of Stage 10 (2026-09-14). This tracks the truth rather than leaving the matrix looking like a
description of working software. A row whose only enforcer is a redirect is not done — that is
prohibition P2.

| Row | Implemented | Enforced by | Evidence |
|---|---|---|---|
| Landing, legal pages | Yes (Stage 11): `/`, `/terms`, `/privacy`, `/data-deletion`. The policy text is a placeholder marked for review by a lawyer. | Public by design; no data | E2E `public.spec.ts` |
| Signup, login, reset | Yes (reset: Stage 7). Signup requires agreeing to the Terms and Privacy Policy (Stage 11), checked on the server before anything else. | Routes; no data access | E2E suite; Stage 7 gate; `policies_not_accepted` spec |
| Email links (`/auth/confirm`) | Yes (two-step since Stage 10) | Opening the link changes nothing. Only the button's Server Action calls `verifyOtp`, and Next.js refuses that action from another origin. Every field is re-validated server-side. | E2E: the link waits for a button, the tampered form, a cross-site action refused (`security.spec.ts`). **Production, 2026-09-15:** the owner completed a real password reset through the button page and signed in with the new password. |
| **Own policy acceptances** (Stage 11) | **Yes** | **RLS** `policy_acceptances_select_own` (own rows, verified + live session) + GRANT `select` only; append-only **triggers** for every role; written only by the signup trigger and `accept_policies()`, which enforces a live session, a verified address and an active account | **Stage 11 gate, below**: production, two real users, 19/19 |
| Verification pending page | Yes | Route | Stage 5 browser gate |
| `/portal` | Yes. Since Stage 11 it also requires the current policy versions to be accepted. | Route gate in `layout.tsx` (a real 307, docs/ISSUES.md row 8) **plus** RLS on the data it reads | Stage 5 browser gate; E2E, including the raw 307 |
| **Own profile row** | **Yes** | **RLS** `profiles_select_own`, `profiles_update_own` (each requiring a live session and `deleted_at is null`) + GRANT `select` and column-level `update (display_name)` to `authenticated` only | **Stage 6 gate, below** |
| **Any other profile row** | **Denied to everyone** | **RLS** (no policy matches) **and** no admin role exists | **Stage 6 gate, below** |
| Audit log | **Yes** | **RLS** own entries only, verified + live session; append-only **triggers** for every role; no client write path; rows written by **triggers on the auth tables**, never by clients | `audit-trail-check.mjs` on production: B saw only B's rows, A only A's, A querying B by id got `[]`, a revoked session read nothing; `rls-check.mjs` forge probe |
| Admin routes | **No** — no admin role exists | — | P6: role changes are manual SQL |

**"Any other profile row" is stricter than the matrix,** which grants Admin "read only, logged". There
is no admin role and no logging yet, so nobody gets that read. Failing closed until the logging
exists is the right order: an admin read that is not logged is exactly what the matrix forbids.

### Stage 6 gate — run 2026-09-14 against production, two real users

`npm run check:rls` (`scripts/rls-check.mjs`), publishable key, no mocks:

```
PASS  CONTROL - user A reads their own row
  query:    GET /rest/v1/profiles?id=eq.8a0d1e65-4a01-4f80-9350-7f7e2852511f   (as A)
  response: 200 [{"id":"8a0d1e65-4a01-4f80-9350-7f7e2852511f","display_name":null}]

PASS  THE GATE - user B reads user A's row by id
  query:    GET /rest/v1/profiles?id=eq.8a0d1e65-4a01-4f80-9350-7f7e2852511f   (as B)
  response: 200 []

PASS  user B lists the entire table
  response: 200 [{"id":"bf00f5b8-af41-4311-a879-efb5041b1c41"}]      <- only B's own

PASS  user B updates user A's row
  response: 200 []                                                    <- zero rows affected

PASS  user B deletes user A's row
  response: 403 "permission denied for table profiles"               <- refused by the GRANT

PASS  user B deletes their OWN row (P5 - must still be refused)
  response: 403 "permission denied for table profiles"

PASS  user A's row is intact afterwards
  response: 200 [{"id":"8a0d1e65-...","display_name":null}]

ALL 7 CHECKS PASSED
```

The CONTROL is what makes `200 []` meaningful: A can see A's row, so B's empty result is a denial
rather than an empty table. The two `403`s show the **GRANT** layer refusing before RLS is consulted
— before the lockdown migration the same request returned `204` and was protected only by the
absence of a delete policy.

### Stage 11 gate: run 2026-09-15 against production, two real users

First, in a browser, user A signed in and was stopped at `/accept-terms`. The policy links showed the
placeholder TODO. A accepted, and the portal read the acceptance back with version and date. After
signing out and in again, A went straight to the portal.

Then `npm run check:rls`, which now covers the ledger too. The Stage 11 section:

```
PASS  user B accepts the current policies through accept_policies()
  response: 200 2                                                    <- two rows newly recorded

PASS  CONTROL - user B reads their own acceptances
  response: 200 [{"document":"terms","version":"2026-09-15-placeholder","source":"accept_page"},
                 {"document":"privacy","version":"2026-09-15-placeholder","source":"accept_page"}]

PASS  user A reads user B's acceptances by user id
  response: 200 []

PASS  user A lists the entire ledger
  response: 200 [{"user_id":"8a0d1e65-…"},{"user_id":"8a0d1e65-…"}]   <- only A's own two rows

PASS  user B inserts an acceptance directly, in user A's name
  response: 403 "permission denied for table policy_acceptances"

PASS  user B rewrites their own acceptance
  response: 403 "permission denied for table policy_acceptances"

PASS  user B deletes their own acceptance
  response: 403 "permission denied for table policy_acceptances"

ALL 19 CHECKS PASSED
```

B's CONTROL is what makes A's `[]` meaningful: B's rows exist, and A still cannot see them. The three
`403`s come from the GRANT layer (authenticated has SELECT only); the append-only triggers would refuse
an UPDATE or DELETE even from a role that bypasses RLS.

### The "signed in, unverified" column

Not testable end to end today — the state cannot currently be entered. See docs/DOMAIN.md for why,
and for why disabling email confirmation does **not** create it. The branching logic is covered by
`src/features/auth/session.test.ts`, including a forged `user_metadata.email_verified`.

## Two related prohibitions

- **P2** — never rely on a route guard as the security boundary for data. A redirect improves the
  experience of a user who took a wrong turn. It does nothing about a request made with `curl`.
- **P4** — never treat "has a session" as "is verified". These are separate checks in separate
  columns above, and they must be separate checks in code.

## Roles

**P6** — no endpoint may grant or change a role. In Phase 1, role changes are manual SQL, run by a
human against the database. There is deliberately no admin UI for this, and building one is out of
scope until well past Phase 1.
