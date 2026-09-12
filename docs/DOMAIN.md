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
