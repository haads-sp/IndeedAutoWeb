# Issues

One row per problem that actually occurred. Not a backlog — a record of things that went wrong and
what was done about them.

**Status starts at `FIXED?` and only becomes `VERIFIED` on evidence from reality.** Evidence means
the symptom was observed to stop occurring, not that the code looks right. Marking a row `VERIFIED`
on belief is the failure mode this table exists to prevent (prohibition P7).

| # | first seen | symptom | diagnosis | fix | status |
|---|---|---|---|---|---|
| 1 | 2026-09-12 | Every git-triggered Vercel deploy silently failed. `alsayeed.ca` stayed frozen on Stage 2 code — `/ping` served fine, `/signup` returned 404 — while CI was green and `git push` reported success. Surfaced only by a Vercel email: "haadlit.co@gmail.com attempted to deploy a commit … but they're not a member of the team." | `haadlit.co@gmail.com` was not a verified email on the GitHub account, so GitHub could not attribute the commits to a user. `gh api repos/HaadLIT/IndeedAutoWeb/commits` returned `author: null` for **all 8** commits. Vercel's git integration refuses to build a commit whose author it cannot match to a team member. The one deployment that did work was the initial import, triggered from the Vercel UI rather than by a push. | Set the repo-local `user.email` to GitHub's noreply form, `121919462+HaadLIT@users.noreply.github.com`, which always resolves to the account and keeps a personal address out of commit metadata. | VERIFIED |

| 2 | 2026-09-12 | Session cookies in production had **no `HttpOnly` and no `Secure`** flag. `SameSite` was correctly `Lax`. Found by opening DevTools and reading the cookie table. | The flags were set in `src/proxy.ts` only. Session cookies are written in **two** places — the proxy on refresh, and `src/lib/supabase/server.ts` during the sign-in Server Action — and the second passed the library's options straight through. So the path that actually *creates* a session was the unprotected one. Nothing caught it: typecheck, lint, 57 tests, the build, a green CI run and the whole Stage 4 browser gate all passed, because none of them inspects a `Set-Cookie` header. | Extracted `sessionCookieOptions()` into `src/lib/supabase/cookie-options.ts` and pointed both call sites at it, so the attributes exist once. Added 11 tests asserting the flags survive hostile input. | VERIFIED |

| 3 | 2026-09-13 | `main` went red on the E2E workflow. The own-profile update spec failed with the user-facing message "Could not save that. Please try again." | The Stage 5 code was pushed BEFORE the migration creating `profiles` had been applied to the preview project, which is what E2E runs against. The table did not exist, so the update failed. Nothing was wrong with the code: the next commit, pushed after `supabase db push`, was green. | Recorded the ordering rule as a recipe in docs/EXTENDING.md: apply migrations to preview, then production, and only then push the code. | VERIFIED |

| 4 | 2026-09-14 | The E2E spec "session cookies are HttpOnly, SameSite=Lax…" failed on its first attempt and passed on retry. The workflow still showed **success**: Playwright reported it only as `##[notice] 1 flaky`, which turns nothing red. | Inside the shared `signIn()` helper: after clicking "Sign in" the page stayed on **bare** `/login` for the full 5s timeout — no `?outcome=`, so the Server Action never redirected, and the server logged no error. That rules out a wrong password and a rate limit, both of which redirect with an outcome. **Root cause not proven.** The two plausible causes are a click landing while the page was still hydrating, and a slow first submission on a cold runner. First genuine flake in 8 runs. | Addressed both candidates rather than guessing between them: `waitForLoadState('networkidle')` before interacting, and a 15s timeout on the post-submit redirect. Separately, `failOnFlakyTests` is now on in CI, so a pass-on-retry fails the run instead of hiding behind a notice. | FIXED? |

| 5 | 2026-09-14 | `npm run check:rls` reported **ALL 12 CHECKS PASSED** on production while two of those checks tested nothing. | The admin-function probes called each function with no arguments. Two of the three have required parameters, so PostgREST matched no signature and returned `404 function not found`, which the probe accepted as a refusal. The permission check was never reached. | Probes now pass each function its real parameter names and accept only a `permission denied` response; a `404` fails. Arguments chosen so a broken guard would still do no harm. | VERIFIED |

| 6 | 2026-09-14 | **Signup revealed whether an address had a confirmed account.** Two quick signups for a fresh address showed "Too many attempts"; two for an address with a confirmed account showed "Check your email" both times. Present since Stage 3, whose gate had reported signup as enumeration-safe. | Supabase rate-limits confirmation emails per address, but sends none to an address that already has a confirmed account — so that account never hits the limit. Observed on preview: second signup returned `200` for an existing confirmed address and `429 over_email_send_rate_limit` for a fresh one. `signup.ts` mapped `429` to `rate_limited`, turning that into a visible difference. Stage 3's gate tested only the existing-account path, which really is identical every time. Password reset had the same shape and was fixed in Stage 7; signup was not re-checked. | `429` now maps to `verification_sent`, identical to success. A real person is throttled by our own Upstash `signup` limit, which keys on the typed address whether or not it has an account. Unit test plus a mutation test pin the mapping. | VERIFIED |

## Notes on row 1

**Why it went unnoticed.** Three separate signals all said "fine": `git push` succeeded, GitHub
Actions went green, and the site was up. Nothing in that set actually asserts *a deployment
happened*. The only signal was an email, and email is not a monitoring system.

**What would have caught it.** Checking that the deployed commit matches `HEAD`, rather than
checking that the site returns 200. `/signup` returning 404 was visible for some time and was read
as "not deployed yet" rather than "deploys are broken" — the difference between those two is the
whole bug.

**VERIFIED 2026-09-12.** After the fix, a push produced a deployment and `/api/version` returned:

```json
{"commit":"107318374d7759ee5ee4fb15da801a599e35f5c6","branch":"main",
 "environment":"production","builtAt":"2026-09-12T08:15:44.576Z"}
```

which matches `git rev-parse HEAD` exactly. The symptom is gone, and the gap that hid it is closed:
`/api/version` now makes "is the deployed commit the one I pushed?" a question with an answer.

## Verified behaviours (not issues, but evidence worth keeping)

**Signing out in one tab prevents writes from another (2026-09-12).** Tested by hand: signed in,
duplicated the tab, signed out in one, then attempted a write in the other. The write did not
happen — the second tab was redirected to sign-in — and no orphan row was created.

Worth recording because it confirms the session cookie is the authority rather than anything held
in the page, and because it exercises `src/app/ping/write-action.ts`'s own `getClaims()` check
rather than only the page's. A route that redirects while its action still writes is a real and
common failure; this one does not have it.

## Notes on row 2

**How it was found.** By opening DevTools and reading the cookie table, because someone asked for
the actual values. It had been reported as satisfied on the strength of the source saying
`httpOnly: true` — in one of the two files that needed it.

**The general shape.** A security control written in two places is a control that will be correct
in one of them. The fix is not "remember to update both"; it is to make there be one place.

**What would have caught it earlier, and now does.** `tests/e2e/auth.spec.ts` signs in with a real
browser and asserts the actual cookies carry HttpOnly, SameSite=Lax and path=/, plus a separate
spec asserting `document.cookie` cannot see the session at all — the property HttpOnly actually
buys. Both ran green in CI on 2026-09-12 (12 passed). The spec guards against passing vacuously
with an explicit check that at least one `sb-` cookie was found.

Still short of proof: the assertion has not been mutation-tested, i.e. nobody has flipped
httpOnly to false and watched it go red. Doing so needs the E2E account password, which lives only
in GitHub secrets.

**Why the Stage 4 gate did not catch it.** Every check in that gate is about behaviour a user can
see — signing in, reloading, signing out. Cookie flags are invisible in that frame. A gate made
only of user-visible behaviour cannot detect a control that is invisible until it fails.

**VERIFIED 2026-09-12.** After a fresh sign-out and sign-in on production, the DevTools cookie
table shows the `sb-` cookies with HttpOnly ticked, Secure ticked, and SameSite Lax. Confirmed by
observing the browser, which is the only place this was ever visible.


## Notes on row 4

**Why it stays FIXED?, and what would move it.** The fix targets likely causes; it was not
confirmed against a reproduction, because the flake could not be reproduced on demand. It becomes
VERIFIED only after a meaningful run of CI with `failOnFlakyTests` on and **no** flaky tests —
evidence that the symptom stopped, rather than an argument that it should have.

**The bigger fix is the config line, not the helper.** A retry that silently turns a failure
green is what lets a suite decay: each flake is individually harmless, and together they train
everyone to re-run red builds without reading them. Making flakiness fail the run keeps the suite
honest regardless of which cause this particular flake had.


## Notes on row 5

**VERIFIED 2026-09-14.** Re-run on production after the fix: `admin_purge_deleted_accounts`,
`admin_restore_account` and `write_audit` each returned `403 permission denied for function`. Before
asking for that re-run, the corrected arguments were checked as an anonymous caller, where no-argument
calls to the two affected functions returned 404 and real-argument calls returned 401 permission
denied — confirming both the diagnosis and the fix.

**The general shape, and why it matters beyond this script.** A security check that cannot fail is
not a check. Every check in this repository that passes on a refusal needs a way to tell "refused"
apart from "never asked" — the CONTROL rows in both check scripts exist for the same reason.

**The irreversible branch, and append-only, on preview (2026-09-14).** Stage 8 shipped
`admin_purge_deleted_accounts()` without ever having run it, and append-only triggers that had never
been triggered. Both were tested against the junk account left in the preview project by the Stage 6
signup probe (`ca96c3aa-95a9-49b8-8f08-5d651b06ba24`, never confirmed), in four separate SQL runs —
separate because the SQL editor runs a paste as one transaction, and the append-only attempts are
meant to error, which would otherwise roll back the purge being observed.

1. Marked it soft-deleted 31 days ago. The would-be-purged list showed that account and nothing else.
2. `select public.admin_purge_deleted_accounts();` returned **`1`** — so the function's owner *can*
   delete from `auth.users`, the specific risk flagged before running it.
3. The audit row **survived the deletion it records**:

   ```
   action          account.purged
   actor_id        null
   metadata        {"grace":"30 days","soft_deleted_at":"2026-08-14T07:06:19.206354+00:00"}
   auth_user_still_exists   0
   profile_still_exists     0
   ```

   `soft_deleted_at` matches step 1's `deleted_at` exactly — the log preserves when the account was
   marked even though the account no longer exists anywhere else.

4. As the **table owner** — which holds UPDATE, DELETE and TRUNCATE privileges — each was attempted
   inside its own exception handler:

   ```
   precondition: rows to test against   1 (ok)
   UPDATE     refused: audit_log is append-only: UPDATE is not permitted
   DELETE     refused: audit_log is append-only: DELETE is not permitted
   TRUNCATE   refused: audit_log is append-only: TRUNCATE is not permitted
   rows remaining afterwards            1 (was 1)
   ```

   Privileges permitted all three; only the triggers refused them. The precondition row is what makes
   the refusals meaningful: row-level triggers do not fire on an empty table, so an UPDATE or DELETE
   against zero rows would have "succeeded" and proved nothing (the lesson of row 5).

**Still not done:** the purge is not scheduled. It works; nothing runs it.


## Notes on row 6

**VERIFIED 2026-09-14, end to end, with a counterfactual.** The real `/signup` Server Action was
driven locally against the preview project, which had already been observed returning `429`. The same
four submissions were made with the old mapping temporarily restored, and then with the fix:

```
                           existing confirmed account     fresh address
WITHOUT the fix            /verify-email?state=sent       /signup?outcome=rate_limited&retry=60
WITH the fix               /verify-email?state=sent       /verify-email?state=sent
```

The first row is the leak, visible in the product; the second is the fix. The file on disk was
confirmed to hold the fixed mapping afterwards, and the unit tests re-run green.

**The general lesson, which this repository has now learned twice.** Any Supabase response that
depends on whether an email is actually sent — which depends on whether the account exists — can
leak account existence if surfaced. When a fix for one flow addresses a pattern, every other flow
with that shape must be re-checked in the same change. Reset got the fix in Stage 7; signup, with
the identical shape, waited until Stage 9.
