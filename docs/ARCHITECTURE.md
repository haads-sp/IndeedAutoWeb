# Architecture

**The boundary rule.** Imports flow one way only — `app/` → `features/` → `lib/` → `types/`, never
outward and never between sibling features — and no module that reads a server secret may be
reachable from a `'use client'` file.

## Layers

Data flows down the arrows. Imports point the same way. Nothing points back up.

```
                 browser
                    │  request (cookies)
                    ▼
   ┌────────────────────────────────────┐
   │  app/          routes, layouts,    │  composition only: read input,
   │                route handlers      │  call a feature, render a result
   └───────────────┬────────────────────┘
                   │ imports
                   ▼
   ┌────────────────────────────────────┐
   │  features/     one dir per         │  owns its logic and its tests;
   │                use case            │  siblings never import each other
   └───────────────┬────────────────────┘
                   │ imports
                   ▼
   ┌────────────────────────────────────┐
   │  lib/          env, supabase,      │  shared capability; knows nothing
   │                logging             │  about any particular use case
   └───────────────┬────────────────────┘
                   │ imports
                   ▼
   ┌────────────────────────────────────┐
   │  types/        shared types        │  imports nothing at all
   └────────────────────────────────────┘
                   │
                   ▼
        Postgres (RLS is the boundary)
```

## Directories

The **constraint** column is the point of this table. A directory without a constraint is just a
folder.

| Directory | Contents | Constraint |
|---|---|---|
| `src/app/` | App Router routes, layouts, route handlers | Composition only. No business logic, no direct database access. A redirect here is a convenience, never a security boundary. |
| `src/features/` *(Stage 3+)* | One directory per use case; logic and its tests | A feature may not import another feature. Shared code moves down to `lib/`, never sideways. |
| `src/lib/env/` | The environment registry and the two assertions | The **only** module permitted to read `process.env`. `server.ts` carries `import 'server-only'`. |
| `src/lib/supabase/` *(Stage 2)* | `@supabase/ssr` client factories | The only place Supabase keys are referenced. Server access decisions use `getClaims()`, never `getSession()`. |
| `src/lib/logging/` *(Stage 9)* | Structured events, correlation id, redaction | Records what happened. Never drives behaviour. Nothing leaves the process unredacted. |
| `src/lib/observability/` *(Stage 10)* | Sentry options and event scrubbing | Server only; nothing Sentry-related reaches the browser. Pure, so the scrubbing is tested without a DSN. |
| `src/lib/security/` *(Stage 10)* | The Content-Security-Policy builder | Pure. The policy is asserted in tests, not read off a response and trusted. |
| `src/types/` *(Stage 2+)* | Shared type declarations | Imports nothing. |
| `scripts/` | Repo tooling (`secret-scan.mjs`) | Run from npm and CI. Never imported by `src/`. |
| `tests/` | Tests not owned by a feature | Fixtures are generated at run time, never committed. |
| `fixtures/` *(Stage 2+)* | Sample data files | The only place `*.csv` / `*.xlsx` / `*.pdf` may be committed. |
| `docs/` | These documents | Prose only. Nothing in `src/` imports from here. |
| `public/` | Static assets, served verbatim | Never a secret. Assume every byte is public. |

Directories marked with a stage do not exist yet. They are listed so the rule has somewhere to point
when they arrive, rather than creating empty folders now.

## How the mechanism is enforced

| Rule | Enforcer |
|---|---|
| Layer direction | `boundaries/dependencies` in `eslint.config.mjs` — element types are declared, the rule is `off` until Stage 3 |
| Server secrets stay server-side | `import 'server-only'` in `src/lib/env/server.ts`; a client import is a build error |
| No secret reaches the browser | `scripts/secret-scan.mjs`, gitleaks, and the `.next/` output scan, all in CI |
| Required env present | `src/instrumentation.ts` calls `serverEnv()` at server start |

## One request, end to end

Stage 1 has exactly one route and no data, so the full path is short:

1. A request for `/` arrives at the Next.js server.
2. On the first request after boot, `src/instrumentation.ts` has already run `register()`, which
   called `serverEnv()`. A missing required variable would have failed server startup by name.
   **It would not have failed the build** — see `docs/DOMAIN.md`.
3. `src/app/layout.tsx` renders, wrapping `src/app/page.tsx`.
4. `page.tsx` is a placeholder. Since Stage 10 it is rendered per request, like every page: the root
   layout awaits `connection()` so each response carries its own CSP nonce (docs/DECISIONS.md).
5. No database is touched, no session is read, no secret is loaded.

Steps 2–5 grow as stages land. The shape — boot assertion, then composition in `app/`, then a
feature, then `lib/`, then Postgres with RLS as the real boundary — does not.
