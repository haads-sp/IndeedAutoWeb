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

The route that consumes it is `src/app/auth/confirm/route.ts`. The `next` parameter is passed
through `safeNext()` (`src/features/auth/safe-redirect.ts`), which allows same-origin paths only —
without it, a crafted link would confirm the user and then forward them, freshly authenticated,
to an attacker's page.

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
