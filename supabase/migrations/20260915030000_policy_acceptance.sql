-- Stage 11: a durable record of which policy versions each account accepted.
--
-- BUILD-PLAN.md Stage 11: "Terms of Service, Privacy Policy, and a Data Deletion policy as routed
-- placeholder pages with the consent plumbing wired up ... the acceptance record in the database."
--
-- A LEDGER, not a flag. One row per (account, document, version) accepted, never updated, never
-- deleted. "Has this account accepted the current Terms?" is answered by reading it; nothing is
-- overwritten when a policy changes, so the record of what someone agreed to, and when, survives
-- every later version.
--
-- Which version is CURRENT is deliberately not stored here. A version belongs to the document's
-- text, and the text lives in the application (src/features/legal/policies.ts), so the two change
-- in the same commit. This table records what a person accepted. docs/DECISIONS.md.
--
-- The ledger is read to decide one thing: whether to show the acceptance page before the portal.
-- That is not the audit log driving behaviour (Stage 9). The audit log records events; this is
-- the consent itself.

-- ===========================================================================
-- 0. Assert the auth columns the signup trigger reads
-- ===========================================================================
--
-- PL/pgSQL resolves columns when a function first RUNS. The trigger below swallows its own
-- errors, so a wrong assumption about auth.users would fail silently at every signup. It is
-- checked here instead, where being wrong stops the migration. (Same approach, and the same
-- reason for pg_attribute, as 20260914072509_audit_auth_events.sql.)

do $$
declare
  missing text;
begin
  select string_agg(required.col, ', ')
    into missing
  from (values ('raw_user_meta_data'), ('created_at')) as required(col)
  where not exists (
    select 1
    from pg_attribute a
    join pg_class c     on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth'
      and c.relname = 'users'
      and a.attname = required.col
      and a.attnum > 0
      and not a.attisdropped
  );

  if missing is not null then
    raise exception 'auth.users is missing expected columns: %', missing;
  end if;
end;
$$;

-- ===========================================================================
-- 1. The ledger
-- ===========================================================================
--
-- No foreign key to auth.users, deliberately, as with audit_log. admin_purge_deleted_accounts()
-- deletes the auth user: a cascading key would be refused by the append-only triggers below and
-- break the purge, and a restricting key would stop the purge from ever running. So a purged
-- account's acceptances remain, holding a user id and nothing else. Whether they SHOULD remain
-- after a purge is a retention question for the lawyer reviewing the policies; see the TODO on
-- src/app/data-deletion/page.tsx.

create table if not exists public.policy_acceptances (
  id          bigint      generated always as identity primary key,
  user_id     uuid        not null,
  document    text        not null,
  version     text        not null,
  accepted_at timestamptz not null default now(),
  -- Where it was accepted: the signup form, or the page shown before the portal.
  source      text        not null,

  constraint policy_acceptances_document_known check (document in ('terms', 'privacy')),
  constraint policy_acceptances_version_shape check (version ~ '^[A-Za-z0-9._-]{1,64}$'),
  constraint policy_acceptances_source_known check (source in ('signup', 'accept_page')),
  -- Accepting a version already accepted records nothing new. Also the lookup index by user.
  constraint policy_acceptances_once_per_version unique (user_id, document, version)
);

comment on table public.policy_acceptances is
  'Append-only ledger of the policy versions each account accepted. Current versions live in the application.';

alter table public.policy_acceptances enable row level security;

-- Supabase grants new public tables to anon and authenticated by default. Remove all of it, then
-- grant back only reading. There is no client write path at all: rows come from the signup
-- trigger and from accept_policies(), which decide what is recorded.
revoke all on public.policy_acceptances from anon, authenticated;
grant select on public.policy_acceptances to authenticated;

drop policy if exists policy_acceptances_select_own on public.policy_acceptances;
create policy policy_acceptances_select_own
  on public.policy_acceptances
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.session_is_active())
    and (select public.email_is_verified())
  );

-- ---------------------------------------------------------------------------
-- Append-only, for EVERYONE, including the secret key (which bypasses RLS but not triggers).
-- ---------------------------------------------------------------------------

create or replace function public.policy_acceptances_is_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'policy_acceptances is append-only: % is not permitted', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists policy_acceptances_no_update on public.policy_acceptances;
create trigger policy_acceptances_no_update
  before update on public.policy_acceptances
  for each row execute function public.policy_acceptances_is_append_only();

drop trigger if exists policy_acceptances_no_delete on public.policy_acceptances;
create trigger policy_acceptances_no_delete
  before delete on public.policy_acceptances
  for each row execute function public.policy_acceptances_is_append_only();

-- Row triggers do not fire on TRUNCATE; this one does.
drop trigger if exists policy_acceptances_no_truncate on public.policy_acceptances;
create trigger policy_acceptances_no_truncate
  before truncate on public.policy_acceptances
  for each statement execute function public.policy_acceptances_is_append_only();

-- ===========================================================================
-- 2. Recorded at signup, by a trigger on auth.users
-- ===========================================================================
--
-- The signup form requires the checkbox and sends the versions the person was shown as
-- user metadata: {"accepted_policies": {"terms": "<version>", "privacy": "<version>"}}. At that
-- moment there is no session, so nothing in the application can write this row. A trigger on
-- the account's creation can, in the same transaction.
--
-- Metadata is user-supplied, and that is acceptable here: it is the person creating the account
-- asserting their own acceptance. What it cannot do is assert anything for someone else, or
-- after the fact. The trigger runs on INSERT only, so editing metadata later records nothing.
--
-- A signup that did not come through our form (a direct call to the Auth API) carries no
-- metadata and gets no row. That account is shown the acceptance page before the portal.
--
-- FAILS OPEN, like the audit triggers: it runs inside the Auth server's transaction, and an
-- error here would stop every signup. The acceptance page is the backstop for a missed row.

create or replace function public.record_signup_policy_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policies jsonb;
  v_document text;
begin
  begin
    v_policies := new.raw_user_meta_data -> 'accepted_policies';

    if jsonb_typeof(v_policies) = 'object' then
      foreach v_document in array array['terms', 'privacy'] loop
        if jsonb_typeof(v_policies -> v_document) = 'string'
           and (v_policies ->> v_document) ~ '^[A-Za-z0-9._-]{1,64}$' then
          insert into public.policy_acceptances (user_id, document, version, accepted_at, source)
          values (new.id, v_document, v_policies ->> v_document, coalesce(new.created_at, now()), 'signup')
          on conflict on constraint policy_acceptances_once_per_version do nothing;
        end if;
      end loop;
    end if;

  exception when others then
    raise warning 'record_signup_policy_acceptance failed: %', sqlerrm;
  end;

  return null; -- AFTER trigger: the return value is ignored.
end;
$$;

revoke all on function public.record_signup_policy_acceptance() from public, anon, authenticated;

drop trigger if exists record_signup_policy_acceptance on auth.users;
create trigger record_signup_policy_acceptance
  after insert on auth.users
  for each row execute function public.record_signup_policy_acceptance();

-- ===========================================================================
-- 3. Recorded on the acceptance page, through the only client-callable path
-- ===========================================================================
--
-- Reachable directly through the Data API by any signed-in session, so every condition the page
-- relies on is enforced HERE: a live session, a verified address, an account that is not deleted.
-- The user id, the time and the source are set by this function; the caller supplies only the
-- versions, and the table's CHECK constraints refuse a malformed one.
--
-- Returns how many rows were newly recorded: 0 when both versions were already accepted.

create or replace function public.accept_policies(
  p_terms_version   text,
  p_privacy_version text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if not (select public.session_is_active()) then
    raise exception 'session is not active' using errcode = 'insufficient_privilege';
  end if;

  if not (select public.email_is_verified()) then
    raise exception 'email address is not verified' using errcode = 'insufficient_privilege';
  end if;

  if not (select public.account_is_active()) then
    raise exception 'account is deleted' using errcode = 'insufficient_privilege';
  end if;

  insert into public.policy_acceptances (user_id, document, version, source)
  values
    (v_uid, 'terms',   p_terms_version,   'accept_page'),
    (v_uid, 'privacy', p_privacy_version, 'accept_page')
  on conflict on constraint policy_acceptances_once_per_version do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.accept_policies(text, text) from public, anon;
grant execute on function public.accept_policies(text, text) to authenticated;

-- Every table still has RLS. If this raises, something above is unprotected.
select public.assert_rls_everywhere();
