# Issues

One row per problem that actually occurred. Not a backlog — a record of things that went wrong and
what was done about them.

**Status starts at `FIXED?` and only becomes `VERIFIED` on evidence from reality.** Evidence means
the symptom was observed to stop occurring, not that the code looks right. Marking a row `VERIFIED`
on belief is the failure mode this table exists to prevent (prohibition P7).

| # | first seen | symptom | diagnosis | fix | status |
|---|---|---|---|---|---|
| 1 | 2026-09-12 | Every git-triggered Vercel deploy silently failed. `alsayeed.ca` stayed frozen on Stage 2 code — `/ping` served fine, `/signup` returned 404 — while CI was green and `git push` reported success. Surfaced only by a Vercel email: "haadlit.co@gmail.com attempted to deploy a commit … but they're not a member of the team." | `haadlit.co@gmail.com` was not a verified email on the GitHub account, so GitHub could not attribute the commits to a user. `gh api repos/HaadLIT/IndeedAutoWeb/commits` returned `author: null` for **all 8** commits. Vercel's git integration refuses to build a commit whose author it cannot match to a team member. The one deployment that did work was the initial import, triggered from the Vercel UI rather than by a push. | Set the repo-local `user.email` to GitHub's noreply form, `121919462+HaadLIT@users.noreply.github.com`, which always resolves to the account and keeps a personal address out of commit metadata. | VERIFIED |

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
