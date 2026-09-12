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
- Next 16 renamed `middleware.ts` to `proxy.ts`, export `proxy`, Node runtime only.

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

---

@AGENTS.md
