# IndeedAutoWeb

This is the first stage of a two-stage software website. We are not working on the actual purpose of
the software right now, and rather just handling the landing page, user accounts and login, accessing
account-specific information and pages which only real verified accounts can access, with all the
safety features and cybersecurity elements that come with it. Once all that is done, the software is
just going to be a Claude wrapper that applies to jobs on Indeed for you.

Phase 1 — this phase — is the account layer only. Nothing in this repository builds toward the
Indeed half, and nothing should until the account layer is finished and proven.

## Status

**Stage 1 of 11: scaffold and documents.** There is one placeholder route and no product. No
Supabase project, no deployment, no authentication code yet. `docs/BUILD-PLAN.md` is the controlling
document and lists every stage.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server on http://localhost:3000 |
| `npm run build` | Production build |
| `npm start` | Serve a production build |
| `npm run lint` | ESLint over the flat config (`next lint` was removed in Next 16) |
| `npm run typecheck` | `next typegen && tsc --noEmit` — typegen first, or route types go unchecked |
| `npm test` | Vitest, once |
| `npm run scan:secrets` | Scan the tree for committed secrets; exits 1 on a hit |

Run `npm run typecheck && npm run lint && npm test && npm run build && npm run scan:secrets` before
pushing. CI runs all of it plus gitleaks, and fails on any of them.

## Setup

1. `npm install`
2. `cp .env.example .env.local` and fill in what you have. Stage 1 requires **nothing** — the
   assertion mechanism exists but no variable is required yet, by design. See
   `src/lib/env/registry.ts`.
3. `npm run dev`

## What this will not do

These are "never," not "should." Each one has a named enforcer. If a change would require violating
one of these, stop and ask instead of working around it.

| # | Never | Enforced by |
|---|---|---|
| P1 | Never put a secret in code, in a `NEXT_PUBLIC_*` variable, or in anything reaching the browser | CI grep, failing the build |
| P2 | Never rely on a route guard as the security boundary for data | Every table has RLS enabled with explicit policies |
| P3 | Never let a stack trace, database error, or internal message reach a user | Error boundary + a generic user-facing message, detail to Sentry only |
| P4 | Never treat "has a session" as "is verified" | Verification checked separately, everywhere it matters |
| P5 | Never hard-delete user data on a user-initiated action | Soft-delete with `deleted_at`, purge is a separate admin path |
| P6 | Never build an endpoint that grants or changes a role | Role changes are manual SQL only, in Phase 1 |
| P7 | Never claim something works without running it | The report shape in BUILD-PLAN.md §0 |
| P8 | Never leave a stub you replaced | Deleted in the same commit as its replacement |

Stubs currently in the tree, both marked in-file and both owned by Stage 11:
`src/app/page.tsx` and the placeholder metadata in `src/app/layout.tsx`.

## Documents

| File | What it is for |
|---|---|
| `docs/BUILD-PLAN.md` | The controlling build document. All eleven stages, and the rules. |
| `docs/ARCHITECTURE.md` | The boundary rule, the layers, and the constraint on each directory. |
| `docs/DECISIONS.md` | Why things are the way they are. Do not re-litigate; supersede with a dated entry. |
| `docs/DOMAIN.md` | External facts that did not work the way the documentation said. |
| `docs/SECRETS.md` | Every variable: what it is, where it lives, whether it reaches the browser. |
| `docs/ACCESS-CONTROL.md` | The access matrix. Every row must become an RLS policy, not a route guard. |
| `docs/ISSUES.md` | Problems that actually happened. `VERIFIED` only on evidence. |
| `docs/EXTENDING.md` | Recipes, added once a pattern exists. |
| `CLAUDE.md` | Session-start context. Deliberately short. |

## Stack

Next.js 16 (App Router, TypeScript, Turbopack) · Tailwind · Supabase (Postgres, Auth, RLS) ·
`@supabase/ssr` · Vercel · Upstash Redis · Sentry · Resend via Supabase SMTP · Vitest.

The stack is locked by `docs/BUILD-PLAN.md` §5. Do not substitute.

## License

Proprietary — all rights reserved. See `LICENSE`.
