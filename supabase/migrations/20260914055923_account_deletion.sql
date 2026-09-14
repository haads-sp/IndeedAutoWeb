-- Stage 8: account deletion, and the audit log it writes to.
--
-- BUILD-PLAN.md Stage 8 — "The irreversible action. Safe default is the reversible branch."
--   - Soft-delete: deleted_at set, access revoked immediately, data retained through a grace window.
--   - Hard purge is a separate admin path with no user-facing trigger.
--   - Deletion writes an audit row.
--   - Requires re-authentication to initiate.
--
-- The audit_log table is built HERE rather than in Stage 9 (docs/DECISIONS.md). A deletion
-- that nothing records is exactly what P5 and P7 exist to prevent. Stage 9 extends this
-- table; it does not create it.

-- ===========================================================================
-- 1. Close the column gap BEFORE deleted_at acquires meaning
-- ===========================================================================
--
-- Stage 6 granted `select, update` on profiles at TABLE level, so a client could write
-- every column of its own row. RLS restricts rows, never columns. That was latent while
-- nothing read deleted_at. From this migration on, deleted_at IS access control, and a
-- client that could write it could delete itself without re-authenticating or leaving an
-- audit record, and restore itself afterwards. scripts/rls-check.mjs demonstrates the
-- privilege before this migration and its absence after.

revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- A deleted account loses access to its own row immediately, not after its tokens expire.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (
    (select auth.uid()) = id
    and deleted_at is null
    and (select public.session_is_active())
  );

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (
    (select auth.uid()) = id
    and deleted_at is null
    and (select public.session_is_active())
  )
  with check (
    (select auth.uid()) = id
    and deleted_at is null
    and (select public.session_is_active())
  );

-- Whether the CALLER's account is active. Used by the application to refuse a deleted
-- account a usable session: Supabase still lets it sign in, because auth.users is
-- untouched by a soft delete.
create or replace function public.account_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and deleted_at is null
  );
$$;

revoke all on function public.account_is_active() from public, anon;
grant execute on function public.account_is_active() to authenticated;

-- ===========================================================================
-- 2. The audit log
-- ===========================================================================
--
-- "Who, what, when, from where. Append-only." And, from Stage 9: "The audit log is not
-- workflow state. It records what happened; it never drives behaviour." So nothing reads
-- this table to decide anything. Whether an account is deleted is profiles.deleted_at.
--
-- No foreign keys, deliberately. An audit row must outlive the account it describes —
-- a purge deletes the user, and "account.purged" has to survive that.

create table if not exists public.audit_log (
  id          bigint      generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  action      text        not null,
  -- Who acted. Null means the system or an administrator acting through SQL.
  actor_id    uuid,
  -- Whose account this concerns.
  subject_id  uuid,
  ip          inet,
  user_agent  text,
  metadata    jsonb       not null default '{}'::jsonb,

  -- One vocabulary, end to end (BUILD-PLAN.md Stage 9). Adding an action means extending
  -- this list, which is a reviewable schema change rather than a new string appearing.
  constraint audit_log_action_known check (
    action in ('account.soft_deleted', 'account.restored', 'account.purged')
  ),
  constraint audit_log_user_agent_bounded check (
    user_agent is null or char_length(user_agent) <= 512
  )
);

create index if not exists audit_log_subject_idx on public.audit_log (subject_id, occurred_at desc);
create index if not exists audit_log_occurred_idx on public.audit_log (occurred_at desc);

alter table public.audit_log enable row level security;

-- Supabase grants new public tables to anon and authenticated by default. Remove all of
-- it, then grant back only reading.
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

-- docs/ACCESS-CONTROL.md: audit log is "own entries" for signed-in verified users,
-- nothing for anyone else.
drop policy if exists audit_log_select_own on public.audit_log;
create policy audit_log_select_own
  on public.audit_log
  for select
  to authenticated
  using (
    subject_id = (select auth.uid())
    and (select public.session_is_active())
    and (select public.email_is_verified())
  );

-- ---------------------------------------------------------------------------
-- Append-only, for EVERYONE — including the secret key.
-- ---------------------------------------------------------------------------
--
-- RLS cannot guarantee this: the secret key carries BYPASSRLS. Triggers are not bypassed
-- by BYPASSRLS, so a trigger that refuses UPDATE and DELETE makes the table append-only
-- for every role short of one that can drop the trigger itself.

create or replace function public.audit_log_is_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only: % is not permitted', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists audit_log_no_update on public.audit_log;
create trigger audit_log_no_update
  before update on public.audit_log
  for each row execute function public.audit_log_is_append_only();

drop trigger if exists audit_log_no_delete on public.audit_log;
create trigger audit_log_no_delete
  before delete on public.audit_log
  for each row execute function public.audit_log_is_append_only();

-- Row triggers do not fire on TRUNCATE; this one does.
drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_is_append_only();

-- ---------------------------------------------------------------------------
-- The only way a row gets written.
-- ---------------------------------------------------------------------------
--
-- NOT callable by clients. If it were, anyone signed in could write "account.restored"
-- about themselves. Audit rows are written only by the functions below, which decide
-- what happened before recording it.

create or replace function public.write_audit(
  p_action     text,
  p_actor      uuid,
  p_subject    uuid,
  p_ip         text,
  p_user_agent text,
  p_metadata   jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip inet;
begin
  -- A malformed address must not abort the thing being audited. Record it as unknown.
  begin
    v_ip := nullif(p_ip, '')::inet;
  exception when others then
    v_ip := null;
  end;

  insert into public.audit_log (action, actor_id, subject_id, ip, user_agent, metadata)
  values (
    p_action,
    p_actor,
    p_subject,
    v_ip,
    left(p_user_agent, 512),
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

-- Supabase's default privileges can grant EXECUTE on new public functions to anon and
-- authenticated. Revoked explicitly rather than assumed absent.
revoke all on function public.write_audit(text, uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;

-- ===========================================================================
-- 3. Soft delete — the only path a user has
-- ===========================================================================

create or replace function public.soft_delete_own_account(
  p_ip         text default null,
  p_user_agent text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_fresh   boolean;
  v_updated integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if not (select public.session_is_active()) then
    raise exception 'session is not active' using errcode = 'insufficient_privilege';
  end if;

  -- RE-AUTHENTICATION, ENFORCED HERE — not only in the application.
  --
  -- This function is reachable directly through the Data API by any signed-in session.
  -- If the password check lived only in our Server Action, calling this RPC straight
  -- from a browser console would delete an account with no password at all. So it
  -- demands a PASSWORD sign-in within the last five minutes, read from the token's amr
  -- claim, which the Auth server sets and the user cannot write.
  select exists (
    select 1
    from jsonb_array_elements(
      case
        when jsonb_typeof((select auth.jwt()) -> 'amr') = 'array'
          then (select auth.jwt()) -> 'amr'
        else '[]'::jsonb
      end
    ) as entry
    where jsonb_typeof(entry) = 'object'
      and entry ->> 'method' = 'password'
      and jsonb_typeof(entry -> 'timestamp') = 'number'
      and (entry ->> 'timestamp')::numeric >= extract(epoch from now()) - 300
  )
  into v_fresh;

  if not v_fresh then
    raise exception 'recent re-authentication required' using errcode = 'insufficient_privilege';
  end if;

  update public.profiles
     set deleted_at = now()
   where id = v_uid
     and deleted_at is null;

  get diagnostics v_updated = row_count;

  -- Recorded only when something actually changed. A second call on an already-deleted
  -- account returns false and writes nothing, so the log never claims a deletion twice.
  if v_updated = 1 then
    perform public.write_audit('account.soft_deleted', v_uid, v_uid, p_ip, p_user_agent);
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.soft_delete_own_account(text, text) from public, anon;
grant execute on function public.soft_delete_own_account(text, text) to authenticated;

-- ===========================================================================
-- 4. Admin paths — no user-facing trigger, no client grant
-- ===========================================================================
--
-- Run from the Supabase SQL editor. Neither is exposed to anon or authenticated, so no
-- page, button or API call in this application can reach them (P6's spirit: privileged
-- changes are manual SQL in Phase 1).

-- Undo a soft delete during the grace window. Audited.
create or replace function public.admin_restore_account(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.profiles
     set deleted_at = null
   where id = p_user_id
     and deleted_at is not null;

  get diagnostics v_updated = row_count;

  if v_updated = 1 then
    perform public.write_audit('account.restored', null, p_user_id, null, null);
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.admin_restore_account(uuid) from public, anon, authenticated;

-- The irreversible branch. Deletes the auth user, which cascades to profiles. The audit
-- row is written FIRST and has no foreign key, so it survives the deletion it records.
create or replace function public.admin_purge_deleted_accounts(
  p_older_than interval default interval '30 days'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   record;
  v_count integer := 0;
begin
  if p_older_than < interval '0 seconds' then
    raise exception 'grace period cannot be negative';
  end if;

  for v_row in
    select id, deleted_at
      from public.profiles
     where deleted_at is not null
       and deleted_at <= now() - p_older_than
     for update
  loop
    perform public.write_audit(
      'account.purged',
      null,
      v_row.id,
      null,
      null,
      jsonb_build_object('soft_deleted_at', v_row.deleted_at, 'grace', p_older_than::text)
    );

    delete from auth.users where id = v_row.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.admin_purge_deleted_accounts(interval) from public, anon, authenticated;

-- Every table still has RLS. If this raises, something above is unprotected.
select public.assert_rls_everywhere();
