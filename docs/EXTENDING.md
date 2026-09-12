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
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/ping">
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
