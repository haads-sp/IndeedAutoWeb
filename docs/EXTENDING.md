# Extending

Recipes for changes someone will make more than once.

A recipe belongs here once a pattern has been established by doing it — not in anticipation. Writing
a recipe for something nobody has built yet produces instructions that are wrong in ways nobody
notices until they are followed.

Each recipe should say: what you are adding, which files you touch and in what order, what the
boundary rule (`docs/ARCHITECTURE.md`) permits here, and how you know it worked.

---

No recipes yet. The first is likely "add a new feature directory", once Stage 3 establishes what a
feature actually looks like.

---

## Recipe: the Supabase email template this app expects

Supabase's default confirmation template links to its own `{{ .ConfirmationURL }}`, which
returns tokens in a **URL fragment** for client-side JavaScript to pick up. That cannot set an
HttpOnly cookie, and it leaves the token in browser history.

This app instead uses the server-side (PKCE) flow: the link carries a `token_hash` to our own
route, which calls `verifyOtp` on the server and writes the session as an HttpOnly cookie.

**Supabase dashboard → Authentication → Email Templates → Confirm signup**, set the body to:

```html
<h2>Confirm your email address</h2>
<p>Follow the link below to confirm this address and finish signing up.</p>
<p>
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/portal">
    Confirm email address
  </a>
</p>
<p>If you did not create an account, you can ignore this message.</p>
```

Opening the link shows `src/app/auth/confirm/page.tsx`, a page with a button, and spends nothing.
The button posts `src/app/auth/confirm/actions.ts`, which is the only thing that calls `verifyOtp`
(logic in `src/features/auth/confirm-link.ts`). Since Stage 10, never make this a GET again: mail
scanners that open links would spend the token first, and any page could sign a visitor into an
attacker's account (docs/DECISIONS.md). The link format itself did not change, so the templates
here are unchanged.

The `next` parameter is passed through `safeNext()` (`src/features/auth/safe-redirect.ts`) on the
page AND again in the action, because a hidden form field can be edited. It allows same-origin
paths only; without it, a crafted link would confirm the user and then forward them, freshly
authenticated, to an attacker's page.

Apply the same template to **every** Supabase project. A project whose template still uses
`{{ .ConfirmationURL }}` will appear to work — the email arrives and the link confirms the
account — but no server-side session cookie is set, so the user lands back at the sign-in form
with no explanation.

---

## Recipe: shipping a schema change

Migrations are applied by a human running the Supabase CLI. CI has no database credentials and
cannot apply them. So **order matters**, and getting it wrong turns `main` red for reasons that have
nothing to do with the code.

**Apply the migration BEFORE pushing code that depends on it.**

```powershell
cd C:\Users\haads\vsCode\IndeedAutoWeb
$env:Path = "C:\Program Files\nodejs;" + $env:Path

# 1. Write the migration, commit it LOCALLY, do not push yet.

# 2. Preview first — always. If the SQL is wrong, find out here.
npx supabase link --project-ref hekickdcijwwycymizpx
npx supabase db push

# 3. Production.
npx supabase link --project-ref ghiawrvzhaqckwljkyrm
npx supabase db push

# 4. NOW push the code.
git push
```

**Why preview first, specifically.** The E2E suite runs against the preview project. If preview has
the migration and production does not, CI stays green while production breaks — which is the worse
of the two failure orders, because nothing tells you.

**What a wrong order looks like.** `docs/ISSUES.md` row 3: code pushed before the migration, E2E
failed on "Could not save that. Please try again.", `main` red until the migration was applied. The
symptom points at the application; the cause is in the database.

**Not automated, deliberately — for now.** Running `db push` from CI means putting the database
password in GitHub secrets. That credential grants full access to the database, which is a
different class of thing from anything currently stored there (a publishable key that is already
public, and a test account for a throwaway preview project). Worth revisiting when schema changes
become frequent enough that the manual step is the bigger risk.

---

## Recipe: the password reset email template

Same reason as the confirmation template above: the default `{{ .ConfirmationURL }}` returns tokens
in a URL fragment that cannot become an HttpOnly cookie. The reset link must go through our own
`/auth/confirm` route, as `type=recovery`, and land on `/reset-password`.

**Supabase dashboard → Authentication → Email Templates → Reset Password**, set the body to:

```html
<h2>Reset your password</h2>
<p>Follow the link below to choose a new password. It works once and expires soon.</p>
<p>
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">
    Choose a new password
  </a>
</p>
<p>If you did not ask to reset your password, you can ignore this message. Your password will not change.</p>
```

**`/reset-password` rejects any session that did not just prove inbox control.** It checks the
token's `amr` claim for a one-time-code sign-in within `RECOVERY_WINDOW_SECONDS` (15 minutes). A
session established with a password cannot use the form, which is what stops someone at an unlocked,
signed-in computer from replacing the password without knowing it.

If a real reset link ever lands on "That reset link has expired" immediately, the likely cause is
that Supabase recorded the recovery sign-in under an `amr` method this code does not recognise. The
accepted set is `INBOX_PROOF_METHODS` in `src/features/auth/password-reset.ts`.

---

## Recipe: adding a page or a form under the Stage 10 protections

What you get for free, and the few ways to break it.

**A new page.** Nothing to add for rendering: the root layout awaits `connection()`, so the page
renders per request and Next.js stamps the request's nonce on its scripts. What breaks it:

- `style={{ … }}` in server-rendered markup. An inline style *attribute* is blocked by the production
  policy; nonces cover `<style>` and `<script>` elements only. Use classes.
- An external script, font, image host or fetch target. The policy allows `'self'` only. Changing
  `src/lib/security/csp.ts` is a security decision, so record it in docs/DECISIONS.md.
- A `'use client'` component that does real work. Errors in it are not reported (there is no browser
  Sentry, by decision); revisit that decision first.
- A protected route with a `loading.tsx` that redirects from its page. The loading state streams
  first, so the redirect becomes a 200 with a meta refresh (docs/ISSUES.md row 8). Make the redirect
  in the route's `layout.tsx` with a gate from `src/app/gates.ts`, call the same gate in the page,
  and add the path to the "real redirect" list in `tests/e2e/public.spec.ts`.
- A `<Link>` to a gated route without `prefetch={false}`. The prefetch runs the gate's database calls
  for a page nobody opened, and each cancelled prefetch reaches Sentry as "The destination stream
  closed early" (docs/ISSUES.md row 9). Add the route to `GATED` in `tests/e2e/public.spec.ts`.

**Proving it:** add the path to the list in `tests/e2e/security.spec.ts` ("pages load and hydrate
with no violations"). That test fails on a blocked script, and checks that the page's own scripts
actually ran.

**A new form.** Use a Server Action. Next.js refuses one whose `Origin` is another site, which is the
CSRF protection. Never change state in a GET: not in a route handler, and not in a page (see
`/auth/confirm`). Treat every submitted field as untrusted, hidden ones included.

**Logging from it.** Call `logEvent()` with the feature's own outcome enum. It reaches the platform
log and Sentry Logs, and any outcome that `levelFor()` rates `error` (today `unavailable`) also opens a
Sentry issue, grouped by event and outcome. Never put a token, password or email address in
`detail`; `scrub()` redacts them anyway, but do not rely on it.

---

## Recipe: publishing reviewed policy text, or changing a policy

The three policy pages are placeholders (Stage 11). Their text is written by, or reviewed by, a
lawyer. Never generated.

**Changing the Terms of Service or the Privacy Policy:**

1. Replace `<PolicyPlaceholder …/>` in `src/app/terms/page.tsx` or `src/app/privacy/page.tsx` with the
   reviewed text. Keep the notes comment at the top current, or delete what the text now covers.
2. In the same commit, change that document's `version` in `src/features/legal/policies.ts`. Use a new
   string matching `^[A-Za-z0-9._-]{1,64}$`, dated, e.g. `2026-11-01`. Drop `-placeholder` only for
   reviewed text.
3. Two tests will fail, on purpose. `src/features/legal/acceptance.test.ts` ("every current version is
   marked as a placeholder") and the placeholder spec in `tests/e2e/public.spec.ts`. Change each to
   match what is now true; do not delete them.
4. Deploy. Nothing in the database changes: the ledger records whatever version the app asks for.

**What happens next, and how you know it worked.** Every account, yours included, is sent to
`/accept-terms` on its next visit to the portal, because nobody has accepted the new version. Sign in
on production: you should see the acceptance page, accept, and the portal's "Policies you accepted"
shows the new version and today's date. Old rows stay in the ledger. That history is the point.

**Adding a document people must accept** is a schema change, not just a code change. Extend the
`document` CHECK constraint on `public.policy_acceptances`, the document array in
`record_signup_policy_acceptance()`, and the parameters of `accept_policies()`, in a new migration.
`src/features/legal/acceptance.test.ts` compares the application's document list with the migration's
CHECK constraint and trigger, and fails until they agree. Apply the migration to preview, then
production, then push (the schema-change recipe above).

**The Data Deletion Policy** is published, not accepted. Changing its text needs no version bump for
consent, but still bump `DATA_DELETION_POLICY.version`, so the page says which text is current. Its
code comment carries a requirement that must be met before real users exist: describe the manual purge
accurately, or schedule it.
