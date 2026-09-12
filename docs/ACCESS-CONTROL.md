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

Nothing above is implemented. This section tracks that honestly rather than leaving the matrix
looking like a description of working software.

| Row | Implemented | Enforced by |
|---|---|---|
| every row | **No** | — |

The `Enforced by` column fills in during Stages 5 and 6 and must name a **policy**, not a route.
A row whose only enforcer is a redirect is not done — that is prohibition P2, and Stage 6's gate is
specifically a cross-tenant query run as a real second user, not a passing unit test.

## Two related prohibitions

- **P2** — never rely on a route guard as the security boundary for data. A redirect improves the
  experience of a user who took a wrong turn. It does nothing about a request made with `curl`.
- **P4** — never treat "has a session" as "is verified". These are separate checks in separate
  columns above, and they must be separate checks in code.

## Roles

**P6** — no endpoint may grant or change a role. In Phase 1, role changes are manual SQL, run by a
human against the database. There is deliberately no admin UI for this, and building one is out of
scope until well past Phase 1.
