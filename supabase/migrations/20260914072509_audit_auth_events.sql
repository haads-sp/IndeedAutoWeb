-- Stage 9: durable, unforgeable audit rows for account events.
--
-- BUILD-PLAN.md Stage 9: "An audit_log table: who, what, when, from where. Append-only."
--
-- These rows come from TRIGGERS ON SUPABASE'S OWN AUTH TABLES rather than from application
-- code, for three reasons (docs/DECISIONS.md):
--
--   1. Unforgeable. No client can write them; they are a side effect of the Auth server
--      actually doing the thing.
--   2. Complete. They fire whatever path caused the event — our pages, a direct API call,
--      the dashboard, a future provider. Application-level logging covers only the paths
--      someone remembered.
--   3. No secret key in the application. The alternative, writing audit rows from the app,
--      would mean giving the app a key that bypasses every RLS policy.
--
-- Failed sign-ins and rate-limit hits leave no row in the auth tables, so they are
-- structured events (src/lib/logging/event.ts) instead, durable in Sentry from Stage 10.

-- ===========================================================================
-- 0. Assert every column this depends on actually exists
-- ===========================================================================
--
-- PL/pgSQL resolves column references when a function first RUNS, not when it is created.
-- If Supabase's auth schema lacked one of these, the triggers below would install cleanly
-- and then fail on every sign-in — and because they swallow their own errors (see below),
-- fail silently. So the assumption is checked here, where being wrong stops the migration.
-- pg_attribute rather than information_schema: the latter hides columns the current role
-- cannot read, which would make a missing-privilege look like a missing column.

do $$
declare
  missing text;
begin
  select string_agg(format('%s.%s', required.tbl, required.col), ', ')
    into missing
  from (values
    ('users',    'email_confirmed_at'),
    ('users',    'encrypted_password'),
    ('sessions', 'user_id'),
    ('sessions', 'ip'),
    ('sessions', 'user_agent'),
    ('sessions', 'aal')
  ) as required(tbl, col)
  where not exists (
    select 1
    from pg_attribute a
    join pg_class c     on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth'
      and c.relname = required.tbl
      and a.attname = required.col
      and a.attnum > 0
      and not a.attisdropped
  );

  if missing is not null then
    raise exception 'auth schema is missing expected columns: %', missing;
  end if;
end;
$$;

-- ===========================================================================
-- 1. The vocabulary grows
-- ===========================================================================

alter table public.audit_log drop constraint if exists audit_log_action_known;
alter table public.audit_log add constraint audit_log_action_known check (
  action in (
    -- Stage 8
    'account.soft_deleted',
    'account.restored',
    'account.purged',
    -- Stage 9
    'account.created',
    'account.email_confirmed',
    'auth.password_changed',
    'auth.session_started',
    'auth.session_ended'
  )
);

-- ===========================================================================
-- 2. auth.users — created, email confirmed, password changed
-- ===========================================================================
--
-- actor_id is left NULL for these. A trigger can see that the row changed but not who made
-- the change: the Auth server writes through its own connection with no user JWT, and a
-- change made through the dashboard or SQL looks identical. Recording the user as actor
-- would be a guess dressed as a fact.

create or replace function public.audit_auth_user_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform public.write_audit('account.created', null, new.id, null, null);

    elsif tg_op = 'UPDATE' then
      if old.email_confirmed_at is null and new.email_confirmed_at is not null then
        perform public.write_audit('account.email_confirmed', null, new.id, null, null);
      end if;

      if old.encrypted_password is distinct from new.encrypted_password then
        perform public.write_audit('auth.password_changed', null, new.id, null, null);
      end if;
    end if;

  -- AN AUDIT FAILURE MUST NEVER BREAK AUTHENTICATION. This trigger runs inside the Auth
  -- server's own transaction; an error here would abort a signup or a password change for
  -- everyone. The error is surfaced as a WARNING in the Postgres logs rather than swallowed
  -- in silence, and scripts/audit-trail-check.mjs verifies the rows actually appear.
  exception when others then
    raise warning 'audit_auth_user_events failed (%): %', tg_op, sqlerrm;
  end;

  return null; -- AFTER trigger: the return value is ignored.
end;
$$;

revoke all on function public.audit_auth_user_events() from public, anon, authenticated;

drop trigger if exists audit_auth_user_created on auth.users;
create trigger audit_auth_user_created
  after insert on auth.users
  for each row execute function public.audit_auth_user_events();

-- WHEN keeps the function from running on the many updates that do not matter — Supabase
-- updates auth.users on every sign-in (last_sign_in_at) and every token refresh.
drop trigger if exists audit_auth_user_changed on auth.users;
create trigger audit_auth_user_changed
  after update on auth.users
  for each row
  when (
    old.email_confirmed_at is distinct from new.email_confirmed_at
    or old.encrypted_password is distinct from new.encrypted_password
  )
  execute function public.audit_auth_user_events();

-- ===========================================================================
-- 3. auth.sessions — started, ended
-- ===========================================================================
--
-- A row in auth.sessions exists only after a successful authentication, and records the
-- IP and user agent the Auth server saw. That is "who, what, when, from where" in one row.
-- Token refreshes UPDATE a session rather than inserting one, so they add no noise.
--
-- ip is passed as ::text rather than host(ip): host() exists only for inet, and a type
-- mismatch here would fail inside the error handler below, i.e. silently. write_audit()
-- casts the text back to inet, and inet::text round-trips ("203.0.113.9/32" -> inet).
--
-- session_started: actor = the user. A session is proof the user authenticated.
-- session_ended:   actor NULL. Sign-out, a global revoke after a password reset, an
--                  account deletion and a purge's cascade all delete sessions, and the
--                  trigger cannot tell them apart.

create or replace function public.audit_auth_session_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform public.write_audit(
        'auth.session_started',
        new.user_id,
        new.user_id,
        new.ip::text,
        new.user_agent,
        jsonb_build_object('session_id', new.id, 'aal', new.aal)
      );

    elsif tg_op = 'DELETE' then
      perform public.write_audit(
        'auth.session_ended',
        null,
        old.user_id,
        old.ip::text,
        old.user_agent,
        jsonb_build_object('session_id', old.id)
      );
    end if;

  -- See audit_auth_user_events: an audit failure must never stop someone signing in.
  exception when others then
    raise warning 'audit_auth_session_events failed (%): %', tg_op, sqlerrm;
  end;

  return null;
end;
$$;

revoke all on function public.audit_auth_session_events() from public, anon, authenticated;

drop trigger if exists audit_auth_session_started on auth.sessions;
create trigger audit_auth_session_started
  after insert on auth.sessions
  for each row execute function public.audit_auth_session_events();

drop trigger if exists audit_auth_session_ended on auth.sessions;
create trigger audit_auth_session_ended
  after delete on auth.sessions
  for each row execute function public.audit_auth_session_events();

select public.assert_rls_everywhere();
