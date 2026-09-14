# Access control

This matrix is reproduced verbatim from `docs/BUILD-PLAN.md` §7. It is the specification, not a
summary of the implementation — nothing in it is enforced yet. Stages 5 and 6 build it, and Stage 6
is where it becomes real, because that is the stage that writes the RLS policies.

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

As of Stage 6 (2026-09-14). This tracks the truth rather than leaving the matrix looking like a
description of working software. A row whose only enforcer is a redirect is not done — that is
prohibition P2.

| Row | Implemented | Enforced by | Evidence |
|---|---|---|---|
| Landing, legal pages | Stub only | No data to protect | `/` is a Stage 11 placeholder |
| Signup, login, reset | Signup + login; **reset is Stage 7** | Routes; no data access | E2E suite |
| Verification pending page | Yes | Route | Stage 5 browser gate |
| `/portal` | Yes | Route redirects **plus** RLS on the data it reads | Stage 5 browser gate; E2E |
| **Own profile row** | **Yes** | **RLS** `profiles_select_own`, `profiles_update_own` + GRANT `select, update` to `authenticated` only | **Stage 6 gate, below** |
| **Any other profile row** | **Denied to everyone** | **RLS** (no policy matches) **and** no admin role exists | **Stage 6 gate, below** |
| Audit log | **Yes** (minimal, Stage 8) | **RLS** own entries only, verified + live session; append-only **triggers** for every role; no client write path | Stage 8 gate; `rls-check.mjs` forge probe |
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
