# Secrets

Every environment variable this application reads, what it is, where it lives, and whether it reaches
the browser.

**The rule.** Anything in the "Browser" column marked **Yes** is public. Not "probably fine" —
public. `NEXT_PUBLIC_*` values are inlined into the JavaScript bundle at build time and are readable
by anyone who loads a page. Prohibition P1 exists because that inlining is invisible at the call
site.

The names and scopes below are declared once, in `src/lib/env/registry.ts`. A test
(`tests/env.test.ts`) fails if that registry and `.env.example` ever disagree, so this table cannot
quietly drift out of date without one of them noticing.

## Variables

| Name | What it is | Where it lives | Browser? |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | The Supabase project's API URL. | Supabase dashboard → Project Settings → API. Set in Vercel (both environments) and `.env.local`. | **Yes** |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key, `sb_publishable_…`. Identifies the project to the client. RLS still gates every query made with it. | Same place. | **Yes** |
| `SUPABASE_SECRET_KEY` | Secret key, `sb_secret_…`. Carries Postgres `BYPASSRLS` — it skips every policy. | Supabase dashboard → API keys. Vercel environment variables only. Never in a file that is committed. | **No — never** |
| `NEXT_PUBLIC_SITE_URL` | Absolute origin of this deployment, e.g. `https://example.com`. Used to build auth redirect URLs. | Vercel, per environment. Differs between production and preview. | **Yes** |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint, for rate limiting. | Upstash console. Vercel environment variables. | **No** |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST token. Grants read and write to that Redis. | Upstash console. Vercel environment variables. | **No** |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry ingest endpoint. Public **by design** — a DSN is a write-only ingest key, not a credential. It permits sending events, not reading them. | Sentry project settings. | **Yes** |
| `SENTRY_AUTH_TOKEN` | Uploads source maps at build time. Grants API access to the Sentry org. | Sentry → auth tokens. Vercel and GitHub Actions secrets only. Build-time only; never read at runtime. | **No** |

## Deliberately not an environment variable

| Thing | Where it actually lives | Why not here |
|---|---|---|
| Resend API key | Supabase dashboard → Authentication → SMTP settings. | Supabase sends transactional email on our behalf. This application never calls Resend, so it must never hold the key. Putting it here would create a credential with no reader — the kind that gets copied somewhere worse later. |
| Database password | Supabase manages it. | Nothing in this app connects to Postgres directly; all access is through the Supabase client, authorised by the keys above. |

## Two environments, two projects

BUILD-PLAN.md §5 locks production and preview to **two separate Supabase projects**. Every Supabase
variable above therefore has two different values, set per-environment in Vercel. A preview
deployment pointing at the production database would make every "is this safe" answer in this
document wrong at once.

## What enforces this

| Rule | Enforcer |
|---|---|
| No secret in a `NEXT_PUBLIC_*` name | `scripts/secret-scan.mjs` pattern 1, run by `npm run scan:secrets` and CI |
| No key-shaped literal committed | `scripts/secret-scan.mjs` pattern 2, plus gitleaks over full history in CI |
| No secret in the build output | The `.next/` scan, run in CI after `next build` |
| Server secrets unreachable from client code | `import 'server-only'` in `src/lib/env/server.ts` — a client import becomes a build error |
| This table matches the code | `tests/env.test.ts` compares `ENV_REGISTRY` against `.env.example` in both directions |

## If a secret is exposed

1. **Rotate it first.** In the vendor dashboard, before anything else. A key in a public commit is
   compromised from the moment it is pushed; deleting the commit does not un-publish it.
2. Update the value in Vercel, and in `.env.local` for anyone working locally.
3. Only then worry about history. Rotation is what makes the leaked value worthless.
4. Add a row to `docs/ISSUES.md`, status `FIXED?`, and move it to `VERIFIED` only once the old value
   is confirmed rejected by the vendor.

## Vercel variable type: Config or Secret

Vercel asks whether each environment variable is a **Config** value or a **Secret**. A Secret is
write-only once saved — you cannot read it back in the dashboard.

The rule is mechanical, and follows the "Browser?" column above:

| Browser-visible | Vercel type |
|---|---|
| Yes (`NEXT_PUBLIC_*`) | **Config** |
| No | **Secret** |

**Never mark a `NEXT_PUBLIC_*` variable as a Secret.** Next.js inlines those values into the
JavaScript bundle at build time, so the value is public no matter what the dashboard says. Marking
it Secret hides it from the people who are allowed to see it, protects it from nobody, and implies
a guarantee that does not exist. If a value genuinely needs to be secret, the fix is to remove the
`NEXT_PUBLIC_` prefix and read it through `src/lib/env/server.ts`, not to change a dropdown.

Current state, for reference:

| Variable | Type | Set where |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Config | Vercel, per environment |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Config | Vercel, per environment |
| `NEXT_PUBLIC_SITE_URL` | Config | Vercel, per environment |
| `SUPABASE_SECRET_KEY` | Secret | Not set — nothing needs `BYPASSRLS` yet |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Secret | Not set — Stage 9 |
| `SENTRY_AUTH_TOKEN` | Secret | Not set — Stage 10 |
| `NEXT_PUBLIC_SENTRY_DSN` | Config | Not set — Stage 10 |
| Resend API key | n/a | Supabase dashboard SMTP settings only. Never a Vercel variable, because this application never calls Resend. |
