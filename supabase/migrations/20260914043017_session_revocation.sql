-- Stage 7: make a revoked session dead at the DATA layer, not only at the route.
--
-- BUILD-PLAN.md Stage 7 gate: "an old session confirmed dead afterwards".
--
-- Supabase's own documentation: "Access Tokens of revoked sessions remain valid until
-- their expiry time, encoded in the exp claim." PostgREST authorises a request by
-- checking the JWT's signature and expiry. It never asks whether the session behind the
-- token still exists.
--
-- So after a password reset signs out every session, the application correctly treats
-- the old session as dead -- currentSession() calls getUser(), which does consult the
-- Auth server -- while a STOLEN access token keeps working against the Data API directly
-- for up to an hour. Resetting your password because someone has your session would not
-- lock them out of your data. Prohibition P2 says the boundary is the RLS policy, not the
-- route, so this is where it has to be fixed.
--
-- session_id is a REQUIRED claim on every Supabase access token (RequiredClaims in
-- @supabase/auth-js), and it is the primary key of auth.sessions. A global sign-out
-- deletes those rows. Checking that the row still exists makes revocation immediate.

create or replace function public.session_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.sessions s
    where s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
      -- Bound to the caller as well as the session id, so a token cannot borrow another
      -- user's live session even if a session id were ever guessable.
      and s.user_id = (select auth.uid())
  );
$$;

comment on function public.session_is_active is
  'True when the session behind the CURRENT access token still exists. Revoked sessions keep valid JWTs until exp; this is what makes revocation immediate at the data layer.';

revoke all on function public.session_is_active() from public, anon;
grant execute on function public.session_is_active() to authenticated;

-- ---------------------------------------------------------------------------
-- Every policy on profiles now also requires a live session.
-- ---------------------------------------------------------------------------
--
-- Wrapped in (select ...) so Postgres evaluates it once per statement as an InitPlan,
-- rather than once per row.

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (
    (select auth.uid()) = id
    and (select public.session_is_active())
  );

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (
    (select auth.uid()) = id
    and (select public.session_is_active())
  )
  with check (
    (select auth.uid()) = id
    and (select public.session_is_active())
  );

-- Still true after this migration, and still checked.
select public.assert_rls_everywhere();
