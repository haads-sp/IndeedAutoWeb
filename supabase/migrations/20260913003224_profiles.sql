-- Stage 5: the profiles table.
--
-- Keyed to auth.users. Deliberately stores NOTHING about how the user authenticated --
-- no password fields, no provider column, nothing that would need migrating when social
-- login arrives in Phase 2 (docs/DECISIONS.md, "Social login deferred to Phase 2").
--
-- Email is NOT duplicated here. It lives in auth.users and copying it would create two
-- answers to "what is this user's address", which drift the first time one is changed.

create table if not exists public.profiles (
  id          uuid        primary key references auth.users (id) on delete cascade,
  display_name text        check (display_name is null or char_length(display_name) between 1 and 80),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- P5: user-initiated deletion is a soft delete. The column exists from the start so
  -- that Stage 8 is a behaviour change rather than a schema migration on live data.
  deleted_at  timestamptz
);

comment on column public.profiles.deleted_at is
  'Soft delete (P5). Set to revoke access while retaining data through a grace window. Hard purge is a separate admin path.';

alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------------
-- Verification, from the one source that cannot be forged
-- ---------------------------------------------------------------------------
--
-- auth.users.email_confirmed_at is the truth. The JWT's user_metadata.email_verified is
-- NOT: any signed-in user can set it with updateUser({ data }), and Supabase will sign
-- the result. See docs/DOMAIN.md.
--
-- SECURITY DEFINER because auth.users is not readable by the authenticated role.
-- search_path is pinned to empty so nothing on the caller's path can be substituted for
-- the objects named here.

create or replace function public.email_is_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users
    where id = (select auth.uid())
      and email_confirmed_at is not null
  );
$$;

comment on function public.email_is_verified is
  'True when the CURRENT user has a confirmed email, read from auth.users. Never trust user_metadata for this.';

revoke all on function public.email_is_verified() from public;
grant execute on function public.email_is_verified() to authenticated;

-- ---------------------------------------------------------------------------
-- Policies, per docs/ACCESS-CONTROL.md
-- ---------------------------------------------------------------------------
--
-- "Own profile row" is Read+Update for signed in unverified AND verified. That is
-- deliberate and matches the matrix: an unverified user is redirected away from /portal,
-- but is not locked out of their own record.
--
-- There is NO insert policy: rows are created by the trigger below, not by clients.
-- There is NO delete policy: with RLS on, an operation without a matching policy is
-- denied, which is what P5 wants -- deletion is a soft delete via update, never a DELETE.

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ---------------------------------------------------------------------------
-- One profile per user, created by the database
-- ---------------------------------------------------------------------------
--
-- In a trigger rather than in application code, so a user created by ANY path -- our
-- signup form, the dashboard, a future social login, an admin invite -- gets a profile.
-- Application code would only cover the path someone remembered.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Backfill anyone who already exists, including the hand-made test users.
insert into public.profiles (id)
select u.id from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- updated_at maintained by the database, not by callers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row
  execute function public.touch_updated_at();
