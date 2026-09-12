# Build Prompt — Phase 1: Accounts, Auth, Gated Portal

Paste this whole document into Claude Code as the opening message of a fresh session. Then commit it
to the repo at `docs/BUILD-PLAN.md` so later sessions can re-read it.

---

## 0. How to use this document

You are building Phase 1 of a consumer web application. Phase 1 is *only* the account layer: a
visitor signs up, verifies their email, signs in, and reaches a portal route that nobody else can
reach. The actual product does not exist yet and you must not invent it.

**This document is executed in stages, not all at once.**

After each numbered stage below, you **stop and report**. Do not begin the next stage until I tell
you to. A stage is not complete because the code is written; it is complete when its gate has been
met with evidence.

When you stop, report in this shape:

```
STAGE <n> — <name>
Done:        <what now exists>
Evidence:    <the command you ran and its actual output, or the query and its result>
Unverified:  <anything you believe works but have not run>
Blocked on:  <anything that needs me — a dashboard setting, a credential, a decision>
Next:        <the first action of the next stage>
```

The `Unverified` line is mandatory and must not be empty unless you genuinely ran everything. Saying
"unverified: the email delivery path, I cannot access an inbox" is correct and useful. Saying
"everything works" when you have not run it is the failure mode this document exists to prevent.

---

## 1. Environment

- Windows. **Use PowerShell.** Do not assume bash is available.
- Node and npm are installed. Use npm unless I say otherwise.
- If a command fails because of the shell, say so and give me the PowerShell equivalent rather than
  retrying variations silently.

---

## 2. What this is, in one paragraph

A web application where a user creates an account and gains access to a private portal. Later, that
portal will host an AI-powered tool that calls a model API on the server's behalf. Phase 1 builds
everything up to and including the portal's front door, and nothing behind it. The value of Phase 1
is that the account layer is genuinely sound — not that it appears to work.

---

## 3. Prohibitions

These are "never," not "should." Each one has a named enforcer. If a change would require violating
one of these, stop and tell me instead of working around it.

| # | Never | Enforced by |
|---|---|---|
| P1 | Never put a secret in code, in a `NEXT_PUBLIC_*` variable, or in anything reaching the browser | CI grep, failing the build |
| P2 | Never rely on a route guard as the security boundary for data | Every table has RLS enabled with explicit policies |
| P3 | Never let a stack trace, database error, or internal message reach a user | Error boundary + a generic user-facing message, detail to Sentry only |
| P4 | Never treat "has a session" as "is verified" | Verification checked separately, everywhere it matters |
| P5 | Never hard-delete user data on a user-initiated action | Soft-delete with `deleted_at`, purge is a separate admin path |
| P6 | Never build an endpoint that grants or changes a role | Role changes are manual SQL only, in Phase 1 |
| P7 | Never claim something works without running it | The report shape in §0 |
| P8 | Never leave a stub you replaced | Deleted in the same commit as its replacement |

---

## 4. Pinned external facts — verified 2026-09-02

**Read this section as authoritative and prefer it over your training data.** These four things
changed recently and the outdated versions are extremely well represented in the code you have seen.
Using the old form will produce code that looks correct, compiles, and fails.

**4.1 — Supabase API key names.** The `anon` and `service_role` keys are being retired in favour of
`sb_publishable_…` and `sb_secret_…`. New Supabase projects do not issue the old keys at all. Use:

- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — safe in the browser, RLS still gates every query
- `SUPABASE_SECRET_KEY` — carries Postgres `BYPASSRLS`, skips every policy, server only, never
  prefixed `NEXT_PUBLIC_`

Do not write `NEXT_PUBLIC_SUPABASE_ANON_KEY` anywhere.

**4.2 — The auth-helpers packages are dead.** `@supabase/auth-helpers-nextjs` is deprecated and
unmaintained, final version 0.15.0. Use **`@supabase/ssr`**. Do not install any
`@supabase/auth-helpers-*` package. The client factories are `createBrowserClient` and
`createServerClient` from `@supabase/ssr`.

**4.3 — Server-side access control uses `getClaims()`, not `getSession()`.** `getClaims()` validates
the JWT signature against the project's published keys on every call. `getSession()` does not
revalidate and must never be the basis of an access decision on the server. This is the single most
likely subtle mistake in this build.

**4.4 — Cloudflare is DNS-only.** The domain is on Cloudflare with the proxy off (grey cloud);
Vercel terminates TLS. Do not write code or config that assumes Cloudflare headers, Cloudflare
Workers, or `CF-Connecting-IP`. For client IP, use the standard Vercel request headers.

If any of these appears wrong while you work, **stop and tell me** rather than reverting to the
older pattern. Add a dated entry to `docs/DOMAIN.md`.

---

## 5. Stack, locked

Do not substitute. If you think something here is a mistake, say so and wait.

- Next.js, App Router, TypeScript
- Supabase — Postgres, Auth, RLS
- `@supabase/ssr` for session handling
- Vercel — hosting, two environments (production and preview) pointed at **two separate Supabase
  projects**
- Upstash Redis — rate limiting
- Sentry — error tracking
- Resend via Supabase custom SMTP — transactional email
- Tailwind for styling

**Not in Phase 1, do not add:** Stripe, PostHog, any vector database, any ORM layer on top of
Supabase, any state management library, any component library beyond what Tailwind gives you.

---

## STAGE 1 — Scaffold and documents

Build nothing that a user can see. The output of this stage is a repo that builds green on CI and a
set of documents that are thin but real.

### 1a. Project scaffold

- Next.js App Router + TypeScript, Tailwind configured.
- `.gitignore` covering: `.env*` except `.env.example`, `.next/`, `node_modules/`, `.vercel/`, IDE
  directories for both VS Code and JetBrains, and `*.csv` / `*.xlsx` / `*.pdf` outside a
  `fixtures/` directory.
- `.env.example` listing every variable by name with empty values and a one-line comment each.
- A startup assertion module that validates every required environment variable at boot and throws
  **naming the missing variable**. A missing variable must never surface as a confusing runtime
  error deep in a request.

### 1b. CI — GitHub Actions, on every push

Must run and must fail the build on any failure:

1. `tsc --noEmit`
2. lint
3. tests
4. `next build`
5. **gitleaks**
6. The secret greps below, as a hard failure:

```powershell
# any secret hiding behind a public prefix
grep -rn "NEXT_PUBLIC_.*SECRET\|NEXT_PUBLIC_.*SERVICE_ROLE" --exclude-dir=node_modules .
# any literal secret key committed
grep -rn "sb_secret_" --exclude-dir=node_modules .
# any secret that made it into the build output
grep -r "sb_secret_" .next/
```

Write these as a step that fails when any of them *matches*. Include a test that plants a fake
`sb_secret_TEST` string in a scratch file and confirms CI catches it, then removes it.

### 1c. Boundary check

Wire up `eslint-plugin-boundaries` (or `no-restricted-imports`) with an **empty ruleset that
passes**. The mechanism must exist now so the first real rule is a one-line change later.

### 1d. Documents

Create these, thin. Do not write fiction — if you don't know something yet, write the question.

- `README.md` — the problem in one paragraph, in a user's words. A "What this will not do" section
  containing the prohibitions from §3. Build, run, test, lint commands, one line each.
- `docs/ARCHITECTURE.md` — under 100 lines. Must contain, in this order: (1) the boundary rule as a
  single sentence at the top, (2) an ASCII diagram of the layers and data direction, (3) a table of
  directory → contents → **the constraint that applies to it**, (4) how one request flows end to
  end. The constraint column is the one that matters; do not omit it.
- `docs/DECISIONS.md` — one entry per decision, dated, in this format:

```markdown
## <Decision>            (YYYY-MM-DD)

**Decision.** What we do.
**Why.** The measurement or observation. Numbers if you have them.
**Rejected.** The obvious alternative, and the specific thing that killed it.
**The line that does not move.** The non-negotiable principle, if any.
```

  Seed it with: Supabase Auth over Clerk; server-side-only model calls; single Postgres over a
  second database; social login deferred; landing page built last.

- `docs/DOMAIN.md` — empty with a header. This is for facts that turned out not to work the way the
  documentation said. You will fill it.
- `docs/ISSUES.md` — table header only: `# | first seen | symptom | diagnosis | fix | status`.
  Status starts at `FIXED?` and only becomes `VERIFIED` on evidence from reality.
- `docs/EXTENDING.md` — empty with a header. Recipes go here when you establish a pattern someone
  will repeat.
- `docs/SECRETS.md` — a table of every variable: name, what it is, where it lives, browser-visible
  yes/no.
- `docs/ACCESS-CONTROL.md` — the matrix in §7 below, verbatim.
- `CLAUDE.md` — the content in §6 below.
- `LICENSE`.

### Gate for Stage 1

`git push` produces a green CI run, and the planted-secret test demonstrably fails the build when
the fake secret is present. Show me the CI run output. Then stop.

---

## 6. CLAUDE.md content

Write this file at the repo root. Keep it short — it is read at the start of every session, and
length dilutes it.

```markdown
# CLAUDE.md

## Environment
Windows. Use PowerShell. Do not assume bash.

## Read first
1. docs/ARCHITECTURE.md — the boundary rule and the layer table
2. docs/DECISIONS.md — why things are the way they are; do not re-litigate
3. docs/DOMAIN.md — external facts that surprised us
4. docs/EXTENDING.md — recipes for common changes

Do not duplicate content from those files here. Duplication drifts.

## What matters most here
This is the account layer of a consumer application. The whole value of this phase is that
authentication and tenant isolation are genuinely correct, not that they appear to work.
A route that redirects is not a security boundary; a Row Level Security policy is. When a
choice is ambiguous, take the one that fails closed.

## Pinned external facts (see docs/DOMAIN.md for dates)
- Supabase keys are `sb_publishable_` / `sb_secret_`. Never `anon` / `service_role`.
- Use `@supabase/ssr`. Never `@supabase/auth-helpers-*` — deprecated and unmaintained.
- Server-side access control uses `getClaims()`, never `getSession()`.
- Cloudflare is DNS-only, proxy off. Vercel terminates TLS.

## Verify before claiming
State plainly when something is unverified. Specific failures this project cares about:
- Claiming a route is protected without requesting it with cookies cleared.
- Claiming RLS works without running a cross-tenant query as a real second user.
- Claiming email works without a real message arriving in a real inbox.
- Marking an ISSUES.md row VERIFIED without evidence the symptom stopped occurring.

## The loop
Structured event → durable row → read the evidence, not your memory of the code.
If a human told you about a bug before the system did, the instrumentation gap is a second
bug. Fix it in the same session.
```

---

## 7. Access control matrix

Write this into `docs/ACCESS-CONTROL.md`. **Every row must be an RLS policy, not only a route
guard.**

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

## STAGES 2–11 — The slice loop

One slice at a time. Each is vertical — storage, logic, presentation — and ends deployed and
runnable. **Stop and report after each.**

Inside every slice, in this order: write the test that defines done → build the smallest code that
passes → instrument it with a structured event carrying a correlation ID → run it in a real
deployed environment → record anything surprising in `DOMAIN.md` and anything decided in
`DECISIONS.md` → delete any stub you replaced, in the same commit.

### Stage 2 — Walking skeleton

The thinnest end-to-end path. It does nothing useful.

A request arrives → a real Supabase user authenticates → one row is written → it is read back
scoped to that user → it renders → deployed on the real domain.

Use a throwaway table. The point is to meet Supabase, Vercel, and the domain for real, now, while
being wrong is cheap.

**Gate:** it runs on the real domain against the real Supabase project, and `docs/DOMAIN.md` has at
least one entry you did not expect to write. If you have nothing to write there, you have not
actually run it.

### Stage 3 — Signup and email verification

Email and password. Verification required. Custom SMTP through Resend.

- Password rules: enforce a minimum length, check against a breached-password list if Supabase
  offers it, do not impose composition rules that push users toward `Password1!`.
- The signup response must be identical whether or not the address already has an account. An
  account-enumeration oracle here is the most common real vulnerability in this flow.

**Gate:** a real message arrived in a real inbox and the link worked. I will do this part; tell me
exactly what to click.

### Stage 4 — Login, logout, session refresh

Middleware refreshes the session. Sessions survive a reload and expire correctly.

- Cookies: `HttpOnly`, `Secure`, `SameSite=Lax`.
- Rate limit login attempts here, not later (Upstash). Per-address and per-IP.
- Note in `DOMAIN.md`: Supabase refresh tokens are single-use, so two tabs refreshing simultaneously
  can produce a transient null session. Handle it rather than being surprised by it.

**Gate:** verified in a browser. Reload, expiry, and logout all shown.

### Stage 5 — Protected portal and profile row

- A `profiles` table keyed to `auth.users`, with RLS.
- Do not assume password auth in the schema — social login arrives in Phase 2.
- `/portal` reachable only by a verified, signed-in user.
- The portal contains a placeholder. Do not invent product features.

**Gate:** `/portal` requested by URL with cookies cleared redirects. An unverified account also
redirects. Show me both.

### Stage 6 — RLS lockdown

This is its own stage on purpose. Route protection and data protection are different claims.

- RLS enabled on every table, with explicit policies per the matrix.
- No table relies on the absence of a policy.
- Verify the secret key is used in exactly the places it must be, and nowhere else.

**Gate:** sign in as a second real user and query the first user's row directly from the client with
the publishable key. It must return zero rows. Show me the query and the actual result. A passing
unit test is not this gate.

### Stage 7 — Password reset

- Identical response for known and unknown addresses.
- Single-use, time-limited token.
- Invalidate all existing sessions on a successful reset.
- Rate limited.

**Gate:** reset completed end to end, and an old session confirmed dead afterwards.

### Stage 8 — Account deletion

The irreversible action. Safe default is the reversible branch.

- Soft-delete: `deleted_at` set, access revoked immediately, data retained through a grace window.
- Hard purge is a separate admin path with no user-facing trigger.
- Deletion writes an audit row.
- Requires re-authentication to initiate.

**Gate:** the row is marked, not gone. Show me the row.

### Stage 9 — Rate limiting and audit log

- Upstash-backed limits on signup, login, reset, and email sends. Per-IP and per-account.
- An `audit_log` table: who, what, when, from where. Append-only.
- **The audit log is not workflow state.** It records what happened; it never drives behaviour.
- Structured events carry a correlation ID. Any operation with more than two outcomes gets an
  **outcome enum**, and those exact names are used in logs, in Sentry grouping, and in user-facing
  copy. One vocabulary end to end.

**Gate:** you hit a limit deliberately and got a readable message, not a stack trace.

### Stage 10 — Security headers and error handling

- CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, frame options.
- CSRF protection on state-changing routes.
- CORS as restrictive as the app allows.
- An error boundary. Users see a friendly message; detail goes to Sentry only.
- Sentry configured to scrub PII — no tokens, emails, or passwords in captured events.
- Loading, error, and empty states for every route that fetches.

**Gate:** force an error in production. The user-visible page is friendly and the trace is in Sentry.

### Stage 11 — Public face

Last on purpose. It is the most visible and most satisfying part to build, and it teaches you
nothing about whether the system works.

- Landing page.
- `robots.txt` and `llms.txt` describing what the site does and its important pages.
- Terms of Service, Privacy Policy, and a Data Deletion policy as **routed placeholder pages** with
  the consent plumbing wired up.

**On the legal pages: do not write the legal text.** Generate the routes, the acceptance record in
the database, and a clearly marked `TODO: requires review by a lawyer` in each. Generated legal
copy that reads professionally is worse than no copy, because it stops me from getting real review.

---

## 8. Before every commit

Run this list. Every item is a mistake a real project made.

- [ ] Am I claiming this works without having run it?
- [ ] Did I replace a stub and leave the stub?
- [ ] Does a comment or doc now say something false because of this change?
- [ ] Is there real personal data in anything I'm about to commit?
- [ ] Does this operation have three endings and a boolean return type?
- [ ] Is this an irreversible action whose default is the irreversible branch?
- [ ] Did I write a rule in a document that nothing checks?
- [ ] Am I marking something fixed on belief rather than evidence?
- [ ] Did I add an abstraction whose second implementation I can't name?
- [ ] Is one table serving as both audit log and workflow state?
- [ ] Is a global holding state that should be per-user?

---

## 9. Start here

Begin with **Stage 1 only**. Before you write code, tell me:

1. Your one-sentence boundary rule for this architecture.
2. The directory tree you intend to create, with a one-line responsibility per directory.
3. Anything in this document you think is wrong.

Then wait for my go-ahead.