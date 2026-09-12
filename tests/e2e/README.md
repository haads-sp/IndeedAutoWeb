# End-to-end tests

Reproduces the manual browser gates from Stages 2–4 so they run on every push.

## Why these exist

`docs/ISSUES.md` row 2. Session cookies reached production without `HttpOnly`. Typecheck, lint,
the unit tests, the build and a green CI run all passed, and so did the Stage 4 browser gate —
because that gate was six steps a human did once. A check performed once is not a check.

## What they run against

A **locally built production app** (`next build` then `next start`) pointed at the **preview**
Supabase project. Never production: this suite signs in, writes rows, and deliberately trips rate
limits.

## What they need

| Variable | What | Where |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Preview project URL | Public; set in the workflow |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Preview publishable key | Public; set in the workflow |
| `NEXT_PUBLIC_SITE_URL` | `http://127.0.0.1:3210` | Set in the workflow |
| `E2E_EMAIL` | A confirmed user in the **preview** project | GitHub Actions **secret** |
| `E2E_PASSWORD` | That user's password | GitHub Actions **secret** |

Without `E2E_EMAIL` / `E2E_PASSWORD` the signed-in specs **skip** rather than fail, and say so. A
suite that silently passes because it did nothing is worse than a red one.

## Running locally

```powershell
$env:E2E_EMAIL = "you@example.com"
$env:E2E_PASSWORD = "your-preview-test-password"
npm run test:e2e
```
