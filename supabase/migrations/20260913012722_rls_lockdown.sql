-- Stage 6: RLS lockdown.
--
-- BUILD-PLAN.md: "No table relies on the absence of a policy."
--
-- That sentence is the whole stage. `profiles` currently refuses INSERT and DELETE
-- because nobody wrote a policy for them, and RLS denies what no policy permits. That
-- works — and it is protection by omission. The day someone adds a broad policy "to fix
-- a bug", the omission stops protecting anything, silently, with no diff that looks
-- dangerous.
--
-- So this migration replaces omission with two independent, explicit layers:
--
--   1. GRANTs  — the `authenticated` role is not permitted to INSERT or DELETE at all.
--                 Postgres checks privileges BEFORE policies, so a future permissive
--                 policy still cannot open a door the grant has closed.
--   2. Policies — explicit, per the matrix in docs/ACCESS-CONTROL.md.
--
-- Either alone would do today. Both means a single mistake is not enough.

-- ---------------------------------------------------------------------------
-- 1. Privileges
-- ---------------------------------------------------------------------------
--
-- Supabase grants SELECT/INSERT/UPDATE/DELETE on new public tables to `anon` and
-- `authenticated` by default. Most of that is wrong for this table.

-- `anon` has no business touching profiles at all. docs/ACCESS-CONTROL.md gives anonymous
-- "—" for every profile row. RLS already denies it; removing the grant means it is denied
-- twice, for two different reasons.
revoke all on public.profiles from anon;

-- `authenticated` keeps exactly what the matrix grants: read and update, own row only.
revoke all on public.profiles from authenticated;
grant select, update on public.profiles to authenticated;

-- Rows are created by the on_auth_user_created trigger, which runs as the definer and does
-- not need the caller to hold INSERT. Deletion is a soft delete via UPDATE (P5); a real
-- DELETE is an admin path that does not exist yet and must not be reachable from a client.

-- ---------------------------------------------------------------------------
-- 2. A guard, so this cannot rot
-- ---------------------------------------------------------------------------
--
-- Raises if any table in `public` lacks RLS. It runs on every `supabase db push`, so
-- adding a table and forgetting to protect it fails the migration rather than shipping.
--
-- This is the enforcer for "RLS enabled on every table". Without it, that line is a rule
-- in a document that nothing checks (BUILD-PLAN.md §8).

create or replace function public.assert_rls_everywhere()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  offender text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into offender
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'          -- ordinary tables only; views have no RLS of their own
    and not c.relrowsecurity;

  if offender is not null then
    raise exception
      'RLS is not enabled on: public.%. Every table needs it (BUILD-PLAN.md P2).', offender;
  end if;
end;
$$;

comment on function public.assert_rls_everywhere is
  'Raises if any public table lacks RLS. Called at the end of every migration that adds tables.';

revoke all on function public.assert_rls_everywhere() from public, anon, authenticated;

-- Run it now. If this migration fails here, a table is unprotected and that is the bug.
select public.assert_rls_everywhere();

-- ---------------------------------------------------------------------------
-- 3. Policies, restated explicitly
-- ---------------------------------------------------------------------------
--
-- Unchanged in effect from Stage 5, repeated here so the full policy set for this table
-- is readable in one place rather than reconstructed from two migrations.
--
-- `to authenticated` matters: without it a policy applies to `public`, which includes
-- `anon`, and the policy body becomes the only thing standing between an anonymous
-- request and the row.

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
