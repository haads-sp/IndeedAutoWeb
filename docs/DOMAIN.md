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

**Open, to confirm at Stage 2.** Which signing scheme our project actually uses. Check the Supabase
dashboard under JWT settings when the project is created, and replace this paragraph with the answer.

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
