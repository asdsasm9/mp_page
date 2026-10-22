-- Migration: Supabase enforces pg-safeupdate on API requests: an UPDATE without a WHERE clause fails with
-- error 21000 "UPDATE requires a WHERE clause". The PGlite tests do not enforce it, so these were missed.
-- Found on the live project (2026-10-22): creating a category failed in bump_pending(). Applied live first.
-- site_state is a one-row table keyed by a boolean id that is always true, so `where id` matches the one row.

create or replace function public.bump_pending() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.site_state set pending_changes = pending_changes + 1 where id;
  return null;
end
$$;
revoke execute on function public.bump_pending() from public, anon, authenticated;

create or replace function public.request_publish() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.site_state;
  v_wait integer;
  v_log_id uuid;
begin
  if not (select public.is_admin()) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;

  select * into v_state from public.site_state where id for update;

  if v_state.last_publish_requested_at is not null
     and v_state.last_publish_requested_at > now() - interval '60 seconds' then
    v_wait := ceil(extract(epoch from (v_state.last_publish_requested_at + interval '60 seconds' - now())))::integer;
    raise exception 'PUBLISH_TOO_SOON' using detail = v_wait::text, hint = 'seconds left: ' || v_wait::text;
  end if;

  insert into public.publish_log (requested_by, status, pending_seen)
    values ((select auth.uid()), 'started', v_state.pending_changes)
    returning id into v_log_id;

  update public.site_state set last_publish_requested_at = now() where id;

  delete from public.publish_log
   where id not in (select id from public.publish_log order by requested_at desc, id desc limit 100);

  return jsonb_build_object('log_id', v_log_id, 'pending_seen', v_state.pending_changes);
end
$$;
revoke execute on function public.request_publish() from public, anon;
grant execute on function public.request_publish() to authenticated;

create or replace function public.record_publish(
  p_log_id uuid,
  p_status text,
  p_pending_seen integer,
  p_albums integer,
  p_photos integer,
  p_bytes bigint,
  p_error text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen integer;
begin
  if not (select public.is_admin()) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  if p_status not in ('ok', 'failed') then
    raise exception 'INVALID_STATUS';
  end if;

  perform 1 from public.site_state where id for update;

  select pending_seen into v_seen from public.publish_log
   where id = p_log_id and status = 'started' for update;
  if not found then
    raise exception 'CONFLICT';
  end if;

  update public.publish_log set
    status = p_status,
    finished_at = now(),
    album_count = p_albums,
    photo_count = p_photos,
    snapshot_bytes = p_bytes,
    error = left(p_error, 1000)
  where id = p_log_id;

  if p_status = 'ok' then
    update public.site_state set
      pending_changes = greatest(pending_changes - coalesce(v_seen, 0), 0),
      last_published_at = now()
    where id;
  end if;

  return jsonb_build_object('ok', true, 'pending_changes', (select pending_changes from public.site_state where id));
end
$$;
revoke execute on function public.record_publish(uuid, text, integer, integer, integer, bigint, text)
  from public, anon;
grant execute on function public.record_publish(uuid, text, integer, integer, integer, bigint, text)
  to authenticated;
