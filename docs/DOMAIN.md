# Domain

External facts that turned out not to work the way the documentation — or a model's training data —
said. Every entry is dated and says how it was established.

Entries marked **verified here** were established by running something in this repo. Entries marked
**from documentation** were read in current vendor docs and have not yet been exercised by our code;
they are recorded because acting on the outdated version produces code that looks correct, compiles,
and fails.

---

## Next.js `middleware` is now `proxy`            (2026-09-12, from documentation)

Next.js 16 deprecated the `middleware.ts` file convention and renamed it to `proxy.ts`, with the
export renamed `middleware` → `proxy`.

> "The `middleware` file convention is deprecated and has been renamed to `proxy`."
> — https://nextjs.org/docs/app/api-reference/file-conventions/proxy (v16.3.5)

Two consequences for work not yet done:

- **BUILD-PLAN.md Stage 4 says "Middleware refreshes the session".** That file is `proxy.ts` and the
  export is `proxy`. Supabase's current Next.js SSR guide is written against this.
- **Proxy runs on the Node.js runtime only.** The docs: "Proxy defaults to using the Node.js
  runtime. The `runtime` config option is not available in Proxy files. Setting the `runtime` config
  option in Proxy will throw an error." This constrains where Stage 9's Upstash rate limiting can
  sit — there is no edge-runtime option there.

A codemod exists: `npx @next/codemod@canary middleware-to-proxy .`

---

## `next lint` no longer exists            (2026-09-12, verified here)

Next 16 removed the `lint` command. The CLI reference lists `dev`, `build`, `start`, `info`,
`telemetry`, `typegen`, `upgrade`, and `experimental-analyze` — no `lint`. `next build` does not lint
either.

**Consequence.** `npm run lint` invokes the ESLint CLI directly (`eslint .`) against the flat config.
A CI step written as `next lint` would silently check nothing while appearing to pass. This is
exactly the shape of failure BUILD-PLAN.md §8 asks about: "Did I write a rule in a document that
nothing checks?"

---

## `tsc --noEmit` alone does not check route types            (2026-09-12, verified here)

Next generates route types only during `next dev` and `next build`, so running `tsc --noEmit` in CI
type-checks the app *without* them.

> "Previously, route types were only generated during `next dev` or `next build`, which meant running
> `tsc --noEmit` directly wouldn't validate your route types."
> — https://nextjs.org/docs/app/api-reference/cli/next

**Consequence.** `npm run typecheck` is `next typegen && tsc --noEmit`, in that order. `next typegen`
also emits `next-env.d.ts`, which is why that file is gitignored.

---

## `instrumentation.ts` does not run during `next build`            (2026-09-12, verified here)

This one matters operationally and was established by experiment, not by reading.

**What was tried.** `SUPABASE_SECRET_KEY` was temporarily marked `requiredFrom: 1` in
`src/lib/env/registry.ts` with no value set in the environment, then `npm run build` was run.

**What happened.** The build **succeeded**, exit 0. `register()` was never called.

**Then `next start` was run against that same build.** It failed as intended, naming the variable:

```
Failed to prepare server Error: An error occurred while loading instrumentation hook:
Missing required server environment variable: SUPABASE_SECRET_KEY. Add it to .env.local
(see .env.example), or to the environment of the deployment you are starting.
```

**Two consequences.**

1. A missing required variable **will not fail a Vercel build**. It will deploy green and fail when
   the server boots. Any stage that marks a variable required must also confirm it is set in the
   Vercel environment — the build passing is not evidence.
2. The failure does not exit the process. The server reports "Failed to prepare server", logs an
   `unhandledRejection`, and **keeps listening** — a request to `/` returned **HTTP 500**, verified
   with `curl`. So "fails at boot" is precise about *when* but not about *how*: it is a permanently
   broken server, not a crashed one. If a future stage needs a hard exit, `register()` has to do it
   explicitly.

---

## `eslint-plugin-boundaries` renamed its rules in v6            (2026-09-12, verified here)

`boundaries/element-types`, `boundaries/entry-point`, `boundaries/no-private` and
`boundaries/external` are all deprecated in v7.2.0, replaced by a single `boundaries/dependencies`.
Using the old names works but emits a migration notice on every violation:

> "More info: https://www.jsboundaries.dev/docs/releases/migration-guides/v5-to-v6/#rule-element-types-renamed-to-dependencies"

Also renamed: `boundaries/no-ignored` → `boundaries/no-ignored-dependencies`, and
`boundaries/no-unknown` → `boundaries/no-unknown-dependencies`.

**Consequence.** `eslint.config.mjs` uses the `dependencies` name, including in the commented-out
policy that Stage 3 will switch on. The mechanism was verified to actually enforce by temporarily
running the rule against a deliberate `features/` → `app/` import, which errored as expected.

---

## `create-next-app` names the package after the directory            (2026-09-12, verified here)

`create-next-app .` inside `IndeedAutoWeb/` fails outright:

```
Could not create a project called "IndeedAutoWeb" because of npm naming restrictions:
    * name can no longer contain capital letters
```

**Consequence.** The scaffold was generated in a lowercase temporary directory and copied in; the
package is named `indeed-auto-web`. Anyone re-running the scaffold in this repo will hit the same
wall. The repository directory name and the npm package name are deliberately different.

---

## Supabase `getClaims()` verifies locally only with asymmetric keys            (2026-09-12, from documentation)

BUILD-PLAN.md §4.3 says `getClaims()` "validates the JWT signature against the project's published
keys on every call". That is true, but the *local* verification — WebCrypto against a cached JWKS,
with no network round trip — happens only when the project uses **asymmetric JWT signing keys**, the
default for projects created on or after 2025-10-01. On a project still using the legacy shared
HS256 secret, `getClaims()` falls back to a network call to the Auth server.

**The rule is unaffected**: never use `getSession()` for an access decision on the server. Only the
stated *reason* depends on the key type.

**RESOLVED (2026-09-12, verified here).** Both projects use **asymmetric** keys. Their JWKS
endpoints each publish one elliptic-curve key:

```
GET https://<ref>.supabase.co/auth/v1/.well-known/jwks.json  -> HTTP 200, 1 key
  production:  kty=EC  alg=ES256  kid=2502318f-963…
  preview:     kty=EC  alg=ES256  kid=ecadd6c2-f36…
```

So `getClaims()` verifies signatures locally via WebCrypto against a cached JWKS, with no network
call to the Auth server — the fast path §4.3 assumes. Nothing needs to change, and the caveat above
is now historical rather than open. If a future project is created on the legacy shared HS256 secret,
this endpoint returns zero keys and `getClaims()` silently becomes a network round trip per call.

---

## npm 11 blocks package install scripts by default            (2026-09-12, verified here)

`npm install` prints:

```
npm warn allow-scripts 1 package has install scripts not yet covered by allowScripts:
npm warn allow-scripts   unrs-resolver@1.12.2 (postinstall: node postinstall.js)
```

`unrs-resolver` arrives via `eslint-plugin-boundaries` and its postinstall did not run. Nothing in
Stage 1 needs it — lint passes and the boundaries rule was verified to enforce correctly without it.

**Open.** If boundaries rules misbehave on module resolution once real cross-layer imports exist in
Stage 3, this unrun postinstall is the first thing to suspect. `npm approve-scripts` is the fix.

---

## Cloudflare was proxying `alsayeed.ca`, contradicting §4.4            (2026-09-12, verified here)

BUILD-PLAN.md §4.4 states as a pinned fact: "The domain is on Cloudflare with the proxy off
(grey cloud); Vercel terminates TLS." It was not. Both CNAMEs were **Proxied** (orange cloud) when
the domain was inspected:

```
alsayeed.ca      CNAME  86ed5c346dc46b45.vercel-dns-017.com  Proxied
www.alsayeed.ca  CNAME  86ed5c346dc46b45.vercel-dns-017.com  Proxied
```

So §4.4 described the intended state, not the actual one. Both were switched to **DNS only**.

**Why this matters beyond tidiness.** With the proxy on, every request reaches Vercel from a
Cloudflare IP. Stage 9 requires rate limiting "per-address and per-IP" — and per-IP limiting against
a proxied domain buckets the entire internet into a handful of Cloudflare egress addresses. It does
not throw an error; it silently rate-limits all users as though they were one. That is the failure
mode §4.4 exists to prevent, and it would have looked like a mysterious bug rather than a
configuration mistake.

**Also note — Vercel's CNAME target is no longer the generic `cname.vercel-dns.com`** that most
documentation still shows. It is a hashed hostname, here `86ed5c346dc46b45.vercel-dns-017.com`.
Vercel's own docs describe it as per-project ("Each project has a unique CNAME record e.g.
`d1d4fc829fe7bc7c.vercel-dns-017.com`"), which suggested the value would have to change when the
domain moved between projects.

**It did not.** The domain was removed from one Vercel project and added to another in the same
account, and the existing CNAME kept working with no edit at all — `https://alsayeed.ca/ping`
returned HTTP 200 serving the new project within seconds. So the hashed target is stable across
projects in the same account, not strictly per-project as the wording implies. Recorded because the
documentation's phrasing predicts an unnecessary DNS edit, and editing a working CNAME to a
"corrected" value is how a live domain gets broken for a propagation cycle.

---

## SPF and DMARC on `alsayeed.ca` will reject Stage 3's email            (2026-09-12, verified here)

Found while moving the domain. Two existing DNS records:

```
alsayeed.ca         TXT  "v=spf1 -all"
_dmarc.alsayeed.ca  TXT  "v=DMARC1; p=reject; rua=mailto:..."
```

`v=spf1 -all` with no mechanisms means **no host on earth is authorised to send mail as this
domain** — it is the correct hardening for a domain that sends no email, which this one currently
does not. `p=reject` then instructs receiving servers to **reject**, not quarantine, anything that
fails alignment.

**Consequence for Stage 3.** Verification email is sent by Resend through Supabase's custom SMTP. If
the sender address is `@alsayeed.ca`, these two records guarantee every message is rejected at the
receiving server. Nothing in the application would report an error: Supabase hands the message to
Resend successfully, Resend sends it, and the recipient's server refuses it. The symptom is "the
email never arrives", with a green path all the way through our own logs.

**Not fixed now, deliberately.** The fix is Resend's own SPF include and DKIM records, and those are
issued per-domain when the sender is set up in Resend. Guessing at them now would mean writing DNS
records we cannot verify. Stage 3 must begin by adding Resend's records and loosening `-all`, and
must not treat "the app reported success" as evidence a message was delivered — BUILD-PLAN.md
already requires a real message in a real inbox for that gate.

---

## Vercel imports `.env.example` and creates every variable EMPTY            (2026-09-12, verified here)

Importing the repo into Vercel silently read `.env.example` and created **all eight** variables
named in it, each with an empty value, scoped to Production and Preview. Nothing warned about this.

The result is a dashboard that lists `SUPABASE_SECRET_KEY`, `UPSTASH_REDIS_REST_TOKEN`,
`SENTRY_AUTH_TOKEN` and the rest as though they were configured. They are blank. Anyone answering
"is production set up?" by looking at that list gets the wrong answer, and adding the real variable
later fails with "A variable with the name … already exists".

**Why it did not break anything.** `findMissing()` in `src/lib/env/registry.ts` treats an empty
string as missing, not as present:

```ts
return value === undefined || value === '';
```

That was written as an obvious-looking edge case with a test beside it ("treats an empty string as
missing, not as present"). It turns out to be the thing that stops a Vercel-imported blank from
satisfying a required variable. Had it checked only for `undefined`, a blank `NEXT_PUBLIC_SITE_URL`
would have passed the boot assertion and produced confirmation emails linking to `undefined`.

**Consequence.** Empty variables for unreached stages were deleted rather than left in place. A
variable should exist in Vercel when it has a value, and not before — otherwise the dashboard stops
being evidence of anything.

---

## Repeat signup for a confirmed address sends no email, and that is the point            (2026-09-12, verified here)

Observed during the Stage 3 gate. Signing up a second time with an address that is already
registered and confirmed produces:

- **the identical `/verify-email` page** — same copy, no hint that the address is taken
- **no email at all**, because Supabase has no confirmation left to send for a confirmed account

Both halves matter. The identical response is what defeats account enumeration; the absent email is
what stops the flow being abused to spam a stranger's inbox, and it means the only place the truth
appears is the inbox itself.

**Consequence for anyone testing this later:** "I signed up and no email arrived" is the EXPECTED
result for an existing confirmed account. It is not evidence that SMTP is broken. Diagnose SMTP with
an address that has never been registered.

**Also:** the password supplied on that second attempt is discarded. Supabase does not modify
credentials on a repeat signup, so the original password still stands. That is deliberate — if it
did overwrite, anyone could reset a stranger's password by "signing up" as them. Changing a password
is Stage 7 and requires proving control of the inbox first.

---

## Supabase refresh tokens are single-use            (2026-09-12, from documentation — NOT yet observed here)

BUILD-PLAN.md Stage 4 flags this and it is worth stating precisely, because the symptom looks
like a bug in our code.

A refresh token may be redeemed **once**. Redeeming it returns a new access token and a new refresh
token, and invalidates the old one. So two tabs that wake up and refresh at the same moment can race:
one redeems the token, the other presents a token that has just been retired and gets nothing back.
The second tab momentarily has **no session**, despite the user being perfectly well signed in.

**What we do about it.** `src/proxy.ts` calls `getClaims()` and, whatever the result,
**never clears a cookie on failure**. A transient failure therefore leaves the existing cookies
untouched and self-heals on the next request. The failure mode we are avoiding is the tempting one:
"no claims, so sign them out" — which would turn a millisecond race into a real logout.

Supabase also allows a brief reuse interval during which the previous refresh token still works,
which should absorb most of this. **That interval is documented behaviour we have not measured.**

**Status: not observed.** No transient null session has been seen in this project. This entry
records the hazard and our position on it; if a user reports being randomly signed out with
multiple tabs open, start here, and add an ISSUES.md row rather than treating this paragraph as
proof it cannot happen.

**Do not "fix" this by making `/ping` (or later `/portal`) tolerate a null session.** Route
protection failing closed is correct. The right place to absorb the race is the refresh path.

---

## Upstash rate-limit windows are epoch-aligned, so "retry in N" understates the wait            (2026-09-12, verified here)

Verified by driving the production login action directly. With a per-address limit of 5 per 15
minutes, attempts 1–5 returned `invalid_credentials` and attempt 6 returned:

```
Location: /login?outcome=rate_limited&retry=37
```

**37 seconds, not 15 minutes.** That is not a bug, and it is not the remaining window either.
`@upstash/ratelimit` aligns windows to wall-clock epoch time (`floor(now / windowMs)`), not to when
a given user's first attempt happened. The probe ran at roughly 21:59:23, and the next 15-minute
boundary was 22:00:00 — 37 seconds away. `reset` is the end of the **current** window, so it can be
anything from the full window down to a second.

**Consequence, and it cuts both ways.** With `slidingWindow`, capacity does not all come back at
that boundary: the previous window's count is still weighted in and decays as the new window
progresses. So the number we show a user can be *optimistic* — they may try again at 37 seconds and
still be blocked. The copy in `src/app/login/page.tsx` deliberately reads "Try again in …" rather
than "You may retry at …", but it is still an estimate presented as though it were exact.

**Not changed now.** The alternative is either a fixed window (which lets an attacker burn a full
quota at the end of one window and again at the start of the next — the reason `slidingWindow` was
chosen) or computing a true worst-case retry and overstating the wait for honest users. Recorded so
that "I waited the time it told me and was still blocked" is a known behaviour rather than a new
investigation.

**Also confirmed in the same run:** a login attempt for an address that has never been registered
returns `invalid_credentials` — identical to a wrong password on a real account. No enumeration
oracle on the login form.

---

## `user_metadata` is user-writable — never authorise on it            (2026-09-12, verified here)

The JWT that `getClaims()` returns includes `user_metadata`, and for an email signup that object
contains `email_verified: true`. It is the obvious thing to check for prohibition P4 ("never treat
having a session as being verified"). **It is also spoofable by the user.**

Evidence, from the shipped types of `@supabase/auth-js` — `UserAttributes.data`, the payload of
`supabase.auth.updateUser({ data })`:

> "A custom data object to store the user's metadata. This maps to the `auth.users.raw_user_meta_data` column."

`raw_user_meta_data` is what surfaces as `user_metadata`. `updateUser` is callable by any signed-in
user with nothing but their own access token. So a user can write
`updateUser({ data: { email_verified: true } })`, and Supabase will mint and **sign** a JWT
containing it. Signature verification proves the token is authentic; it says nothing about whether
the claim inside it is true.

**Where verification actually lives:** `auth.users.email_confirmed_at`. Reachable two ways, both
authoritative:

- `supabase.auth.getUser()` — revalidates against the Auth server and returns `email_confirmed_at`
- SQL against `auth.users`, for use inside an RLS policy

**Rules for this codebase:**

- `getClaims()` answers *"is there a valid session, and who is it"* — fast, local, signature-verified.
- **It does not answer "is this user verified."** That requires `getUser()` or the database.
- `app_metadata` is admin-only and is not user-writable; `user_metadata` is the opposite. Neither
  should carry an authorisation flag, but only one of them is actively dangerous.

This is precisely the trap BUILD-PLAN.md §7 points at: "The 'signed in, unverified' column is the
one that gets skipped." The subtler version is checking it against a field the user controls.

---

## An RLS-denied UPDATE or DELETE returns 204, not an error            (2026-09-13, verified here)

Probing the new `profiles` table anonymously:

```
POST   /rest/v1/profiles   -> 401  "new row violates row-level security policy"
PATCH  /rest/v1/profiles   -> 204
DELETE /rest/v1/profiles   -> 204
```

The INSERT is refused loudly. The UPDATE and DELETE look like they **succeeded**.

They did not. With RLS enabled and no matching policy, the rows are simply not visible to
the statement, so it updates or deletes **zero rows** — which is a perfectly successful
statement. Postgres does not raise; PostgREST returns 204 No Content.

Confirmed by asking for the affected rows explicitly:

```
PATCH  ?display_name=is.null  Prefer: return=representation  -> 200  []
DELETE ?id=not.is.null        Prefer: return=representation  -> 200  []
```

An anonymous request to delete every row in the table affected nothing.

**Consequence for Stage 6's audit, which is the point of writing this down.** Reading
status codes is not a test of RLS. A `204` on a write proves nothing either way, and
`200 []` on a read is equally ambiguous — it means "denied" and "the table is empty" and
"that row does not exist", identically. The only conclusive test is the one BUILD-PLAN.md
Stage 6 demands: sign in as a real second user, query the first user's row by id, and
show the result is zero rows. Anything less confuses "no policy let me see it" with
"nothing was there".

**Why INSERT differs:** a `WITH CHECK` violation happens on a row being created, which has
no existing-row visibility to filter, so there is something concrete to reject.

---

## "Signed in AND unverified" is currently unreachable            (2026-09-13, verified here)

BUILD-PLAN.md §7 gives "Signed in, unverified" its own column and calls it "the one that gets
skipped". Testing it revealed that, as configured, **the state cannot be entered at all.**

With email confirmation required (`mailer_autoconfirm: false`), `signUp` issues **no session**. An
unconfirmed user therefore has nothing to be unverified *with* — they are simply anonymous. And
`signInWithPassword` refuses them, so they cannot obtain one by signing in either.

Observed on production, in order:

1. `/portal` in a private window → redirected to `/login`
2. Signed up with a fresh address, did **not** click the link → the standard "Check your email" page
3. Signed in with those exact credentials → landed on `/verify-email`: *"Your password was correct,
   but this address has not been confirmed yet"*
4. `/portal` again in that same window → still redirected to `/login`

Step 3 is the interesting one: **the password was accepted and it bought nothing.** That is P4
working — "correct credentials" and "verified account" are answered separately.

**The unverified branch in `/portal` stays.** It is defensive code for a state that cannot presently
occur, and that is the point: it becomes reachable the moment someone turns off "Confirm email" in
the Supabase dashboard, enables an auto-confirming provider, or adds social login in Phase 2. A
guard that only exists once the hole opens is a guard added under pressure.

**Consequence for Stage 6.** The access matrix's "signed in, unverified" column cannot be tested
end to end today. Verifying it means temporarily disabling email confirmation on the PREVIEW project
and checking that `/portal` redirects to `/verify-email` rather than rendering. That is worth doing
once, deliberately, and undoing immediately.
