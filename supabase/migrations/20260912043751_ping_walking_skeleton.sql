-- Stage 2: the walking skeleton's throwaway table.
--
-- STUB (Stage 5): `ping` is deleted when the real `profiles` table lands. It exists only
-- to prove one row can be written and read back scoped to its owner, against a real
-- Supabase project, on the real domain. BUILD-PLAN.md Stage 2: "Use a throwaway table.
-- The point is to meet Supabase, Vercel, and the domain for real, now, while being wrong
-- is cheap."
--
-- RLS is enabled here rather than deferred to Stage 6, because Stage 6 is an audit of
-- every table, not the moment protection begins. A table that ships unprotected and gets
-- fixed later has been unprotected in a real deployment (prohibition P2).

create table if not exists public.ping (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  message     text        not null check (char_length(message) between 1 and 280),
  created_at  timestamptz not null default now()
);

comment on table public.ping is
  'STUB (Stage 5): throwaway table for the Stage 2 walking skeleton. Delete with its replacement.';

-- Every policy below filters on user_id, so reads are index-backed rather than seq scans.
create index if not exists ping_user_id_created_at_idx
  on public.ping (user_id, created_at desc);

alter table public.ping enable row level security;

-- Owner-only, and nothing else. There is deliberately no policy granting UPDATE or
-- DELETE: with RLS enabled, an operation with no matching policy is denied. Stage 6
-- verifies that claim against a real second user rather than trusting it.

drop policy if exists ping_select_own on public.ping;
create policy ping_select_own
  on public.ping
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists ping_insert_own on public.ping;
create policy ping_insert_own
  on public.ping
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- `(select auth.uid())` rather than a bare `auth.uid()` is deliberate: wrapping it in a
-- scalar subquery lets Postgres evaluate it once per statement via an InitPlan instead of
-- once per row. Supabase documents this as the recommended form for RLS performance.
