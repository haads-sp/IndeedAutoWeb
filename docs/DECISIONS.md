# Decisions

One entry per decision. Do not re-litigate these; if one is wrong, add a new dated entry that
supersedes it and say so.

---

## Supabase Auth over Clerk            (2026-09-12)

**Decision.** Authentication is Supabase Auth, in the same project as the database.
**Why.** Row Level Security is the security boundary for this app (prohibition P2). RLS policies are
written against `auth.uid()`, which exists because the auth system and the database are the same
Postgres. With an external identity provider, every policy depends on a JWT minted elsewhere and
correctly threaded into every connection — more moving parts in exactly the place we least want them.
**Rejected.** Clerk. Better-looking prebuilt UI and a nicer developer onboarding, but it puts the
identity system outside the database that has to enforce the rules.
**The line that does not move.** The thing that enforces access is a database policy, not a route.

---

## Model API calls happen only on the server            (2026-09-12)

**Decision.** Any call to a model API is made by server code, with the key read through
`src/lib/env/server.ts`. No key, and no direct model call, ever reaches the browser.
**Why.** A key in the browser is a key that has been given away — it is extractable from the bundle
or from devtools by anyone who loads the page, and the bill is ours. This is prohibition P1 with a
specific name attached.
**Rejected.** Calling the model from the client with a short-lived proxied token. It adds a token
minting path and still terminates in the browser holding something spendable.
**The line that does not move.** Nothing spendable is ever shipped to a client.

---

## One Postgres, not two            (2026-09-12)

**Decision.** A single Supabase Postgres holds auth, profiles, audit log, and whatever Phase 2 adds.
**Why.** Two stores means a consistency problem between them, and the first thing to go inconsistent
would be "who is this user" — the one fact every access decision depends on. At this scale there is
no capacity argument for splitting.
**Rejected.** A separate operational database beside Supabase's. The specific thing that killed it:
it buys nothing until there is load we do not have and may never have.
**The line that does not move.** One answer to "who is this user", in one place.

---

## Social login deferred to Phase 2            (2026-09-12)

**Decision.** Phase 1 is email and password only. The schema must not assume password auth.
**Why.** Each provider is its own consent screen, redirect URI set, and failure mode, none of which
teaches us anything about whether the account layer is sound. The cost of deferring is near zero as
long as the schema does not bake in the assumption — so `profiles` keys to `auth.users` and stores
no password-shaped fields.
**Rejected.** Adding Google sign-in in Stage 3 "since it is easy". It is easy; it is also three more
things that can silently half-work while we are trying to establish whether verification is correct.
**The line that does not move.** The schema never assumes how a user authenticated.

---

## The landing page is built last            (2026-09-12)

**Decision.** Stage 11, after everything else.
**Why.** It is the most visible and most satisfying part to build and it teaches us nothing about
whether the system works. Building it first converts "does auth work" into "does auth work, behind a
page I am now reluctant to change".
**Rejected.** Building it first for morale. Real, but the cost is that every later structural fix
has a cosmetic hostage.
**The line that does not move.** Visible progress is not evidence of working software.

---

## Vitest as the test runner            (2026-09-12)

**Decision.** Vitest. `npm test` is `vitest run`; config in `vitest.config.mts`.
**Why.** BUILD-PLAN.md §1b requires tests but §5's locked stack names no runner, so this had to be
decided somewhere. Vitest is one dependency, needs no transform config for TypeScript, and runs
Node-environment tests without a jsdom setup we do not need in Stage 1.
**Rejected.** Jest — needs a transform configured for TS and ESM in a Next project, which is more
config for the same result. Node's built-in `node:test` — no dependency at all, but no `expect`, no
watch UI, and a weaker story when component tests arrive.
**The line that does not move.** None. This is reversible; if component testing gets painful, revisit.

---

## Vitest forced an `@types/node` upgrade            (2026-09-12)

**Decision.** `@types/node` is pinned to `^24`, matching the Node 24 we actually run.
**Why.** `create-next-app` 16.3.5 generates `@types/node@^20`, but Vitest 5 declares a peer of
`^22.0.0 || >=24.0.0`, so `npm install` fails with `ERESOLVE`. Local and CI both run Node 24, so the
generated `^20` was describing a runtime nobody uses.
**Rejected.** `--legacy-peer-deps` or `--force`. Both silence the conflict and leave the types
describing Node 20 while the code runs on Node 24 — the failure mode is a type that says a Node 24
API does not exist, or worse, one that lies in the other direction.
**The line that does not move.** The `@types/node` major tracks the Node major actually in use.

---

## Config file extension is `.mts`, not `.ts`            (2026-09-12)

**Decision.** `vitest.config.mts`.
**Why.** With `.ts` and no `"type": "module"` in `package.json`, Vite loads the config as CommonJS
and warns that ESM syntax is unsupported by the `native` config loader, which is planned to become
its default. `.mts` is unambiguous and silences the warning without touching `package.json`'s module
type, which Next depends on.
**Rejected.** Setting `"type": "module"` — a much wider blast radius for a config-loader warning.
**The line that does not move.** None.

---

## CI runs on `ubuntu-latest`, not `windows-latest`            (2026-09-12)

**Decision.** GitHub Actions on `ubuntu-latest`, Node 24 to match local.
**Why.** Three reasons, in order: §1b's commands are GNU grep; Vercel builds on Linux, so CI should
fail the way production fails; and private-repo minutes bill at 1x on Linux versus 2x on Windows.
Local development is Windows, and the check that matters locally — `npm run scan:secrets` — is a
Node script that runs identically on both.
**Rejected.** `windows-latest` to match the development machine. It would make CI agree with the
developer laptop and disagree with the deployment target, which is the wrong of the two.
**The line that does not move.** CI matches the deployment environment, not the laptop.

---

## gitleaks as a pinned release binary, not the Action            (2026-09-12)

**Decision.** CI downloads a specific gitleaks release tarball and runs it.
**Why.** `gitleaks-action` carries license-key logic for organization accounts and can change
behaviour between major versions. A pinned binary is a fixed, auditable version that behaves the
same today and in six months.
**Rejected.** `gitleaks/gitleaks-action@v2`. Fewer lines of YAML, but it introduces a licensing
question into a security gate, and that gate must not be the thing that mysteriously stops running.
**The line that does not move.** A security check must be deterministic and inspectable.

---

## The env module has no dependencies            (2026-09-12)

**Decision.** `src/lib/env/` is hand-written — a registry, a client reader, a server reader. No
schema-validation library.
**Why.** It needs to do three things: know the variable names, report **all** missing ones at once,
and keep server variables out of client bundles. That is roughly 100 lines. A validation library
would add a dependency to the one module that must be readable by anyone auditing where secrets are
read.
**Rejected.** `zod` + `@t3-oss/env-nextjs`, the conventional choice. It is good, and it is a
dependency and a DSL in the security-critical path, for parsing that is currently "is this string
non-empty".
**The line that does not move.** `src/lib/env/` is the only module that reads `process.env`.

---

## Required env variables are declared per stage, starting empty            (2026-09-12)

**Decision.** `ENV_REGISTRY` carries a `requiredFrom` stage per variable. Every entry is `null` at
Stage 1, so nothing is required yet.
**Why.** The assertion mechanism has to exist before the variables do, or it gets added later under
pressure and skipped. But declaring variables required before anything provisions them means every
build fails for a reason nobody can fix, which trains people to bypass the check.
**Rejected.** Requiring the full Supabase set immediately. There is no Supabase project yet — that
is Stage 2.
**The line that does not move.** A check that cannot pass is worse than no check.

---

## The secret scanner matches key shapes, not key prefixes            (2026-09-12)

**Decision.** `scripts/secret-scan.mjs` matches `sb_secret_` followed by 16 or more key characters,
and skips `docs/`.
**Why.** BUILD-PLAN.md §1b specifies `grep -rn "sb_secret_" .`, which matches this repo's own
documents — `docs/BUILD-PLAN.md`, `CLAUDE.md`, `docs/SECRETS.md`, and the CI file containing the
grep. That check is red on the first commit and red forever after, which teaches everyone to ignore
a security gate.
**Rejected.** The literal §1b form. CI still runs a corrected version of it, so the document's intent
is visibly honoured, but the authoritative check is the Node script.
**The line that does not move.** A gate that cries wolf gets ignored, which is worse than not having
it.

---

## Proprietary license, all rights reserved            (2026-09-12)

**Decision.** A short "all rights reserved" `LICENSE`.
**Why.** §1d requires a `LICENSE` but does not say which, and this is a private commercial product,
not something intended for reuse. The absence of a license file is legally ambiguous; an explicit
reservation is not.
**Rejected.** MIT. It is the reflex choice for a new repo and it grants the world permission to use
a product intended to be sold.
**The line that does not move.** None — this is the owner's call and reversible at any time.

---

## `AGENTS.md` is committed, not deleted            (2026-09-12)

**Decision.** Keep the generated `AGENTS.md`; `CLAUDE.md` is our own file and references it.
**Why.** `next dev` regenerates the `AGENTS.md` rules block on every run — the file says so itself.
Deleting it produces a permanently dirty working tree rather than a clean one. Its content is also
correct and useful: Next 16 differs from what a model's training data says, which this project has
already hit twice (see `docs/DOMAIN.md`).
**Rejected.** Deleting it and gitignoring it — same regeneration, plus the guidance is lost.
**The line that does not move.** None.

---

## Cloudflare proxy stays off, and we accept losing the WAF            (2026-09-12)

**Decision.** `alsayeed.ca` and `www.alsayeed.ca` are CNAMEs to Vercel with Cloudflare's proxy
**off** (grey cloud, "DNS only"). Cloudflare is a registrar and DNS host for this domain, nothing
more. Vercel terminates TLS. This makes BUILD-PLAN.md §4.4 true, which it was not before — see
`docs/DOMAIN.md`.

**Why.** Cloudflare warns that disabling the proxy loses DDoS protection, caching, and security
rules. Two of those three do not apply: Vercel provides DDoS mitigation and a CDN at its own edge,
and putting Cloudflare's cache in front of Vercel's would be a second cache with its own staleness
and ISR-revalidation failure modes. The origin-IP-exposure warning does not apply either — the
"origin" is Vercel's shared anycast range, which is public by design and has no private address to
leak.

What decides it is the third point, which is about correctness rather than protection. Proxied,
every request reaches Vercel from a Cloudflare address. Stage 9 requires rate limiting "per-address
and per-IP"; per-IP limiting against a proxied domain silently buckets all traffic into a few egress
IPs and throttles every user as one. It raises no error — it is simply wrong. The fix would be
reading `CF-Connecting-IP`, which §4.4 explicitly forbids. Stage 4's session cookies are the second
reason: a second TLS-terminating, caching proxy in front of `Set-Cookie` is a class of bug worth
being unable to have.

**Rejected.** Leaving the proxy on for the WAF and bot rules. The specific thing that killed it: it
makes the per-IP half of Stage 9 quietly incorrect, and turns every future session bug into "is it
Cloudflare?" before it can be anything else.

**The cost, stated plainly.** We lose Cloudflare's WAF and bot management. That is a real reduction
in defence in depth, not a wash. It is accepted for a pre-launch application whose actual security
boundary is Row Level Security, and it is revisitable: if the WAF is wanted later, the way back is
Vercel's own firewall, not re-proxying.

**The line that does not move.** Nothing in this application reads a Cloudflare header.

---

## Length and breach history, no composition rules            (2026-09-12)

**Decision.** Minimum 12 characters, maximum 128 bytes, checked against known breaches. **No**
required digits, uppercase, or symbols. Supabase's "Required characters" setting is left at none.

**Why.** BUILD-PLAN.md Stage 3: "do not impose composition rules that push users toward
`Password1!`". Composition rules do not produce entropy, they produce predictable substitutions —
`a`→`@`, a capital on the first letter, a `1!` on the end — while blocking genuinely strong
passphrases like `correct horse battery staple`. Length plus a breach check does the work those
rules pretend to do. The 128-byte ceiling is not a strength rule at all: it is a guard, because
bcrypt-family hashes silently truncate past 72 bytes and unbounded input invites CPU exhaustion by
hashing a megabyte on every attempt.

**Rejected.** Supabase's own documented advice, which is to "use the strongest option of requiring
digits, lowercase and uppercase letters, and symbols". We are deliberately contradicting the vendor
here. The specific thing that killed it: it makes the password field harder to satisfy without
making the password harder to guess.

**The line that does not move.** Password rules are justified by what they do to guessability, not
by how strict they look.

---

## The breached-password check is ours, not Supabase's            (2026-09-12)

**Decision.** `src/features/auth/breached-password.ts` queries HaveIBeenPwned's k-anonymity range
API directly. It sends the first five characters of the password's SHA-1 hash and matches the
returned suffixes locally.

**Why.** Supabase offers this natively, but its docs state "Leaked password protection is available
on the Pro Plan and above" — $25/month, and we have two projects. The check is roughly 25 lines
against a free public API. Doing it ourselves also makes it testable, which the native version is
not: there are tests asserting that the full hash never leaves the process, that padding entries
are not treated as hits, and that an HIBP outage does not reject valid passwords.

**Rejected.** Upgrading to Pro purely for this (a recurring cost for one feature we can write), and
skipping the check entirely (defensible under "if Supabase offers it", but it is the single
highest-value password control available).

**The line that does not move.** The password and its full hash never leave this process. Only five
hex characters go over the wire.

**Deliberately fails open.** If HIBP is unreachable, signup proceeds and `breachCheckSkipped` is
returned so the caller can record that the check did not run. The alternative — a third-party
outage halting all account creation to enforce defence in depth — is worse. `unavailable` must
never be treated as `breached`.
