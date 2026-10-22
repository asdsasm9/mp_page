-- Migration E3: publish bookkeeping and the keepalive ping.

-- Starts a publish: at most one request per 60 seconds. Returns the log id and the pending counter
-- seen now, which record_publish later subtracts. The log keeps the newest 100 rows.
create function public.request_publish() returns jsonb
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

  select * into v_state from public.site_state for update;

  if v_state.last_publish_requested_at is not null
     and v_state.last_publish_requested_at > now() - interval '60 seconds' then
    v_wait := ceil(extract(epoch from (v_state.last_publish_requested_at + interval '60 seconds' - now())))::integer;
    raise exception 'PUBLISH_TOO_SOON' using detail = v_wait::text, hint = 'seconds left: ' || v_wait::text;
  end if;

  insert into public.publish_log (requested_by, status, pending_seen)
    values ((select auth.uid()), 'started', v_state.pending_changes)
    returning id into v_log_id;

  update public.site_state set last_publish_requested_at = now();

  delete from public.publish_log
   where id not in (select id from public.publish_log order by requested_at desc, id desc limit 100);

  return jsonb_build_object('log_id', v_log_id, 'pending_seen', v_state.pending_changes);
end
$$;
revoke execute on function public.request_publish() from public, anon;
grant execute on function public.request_publish() to authenticated;

-- Finishes a publish_log row. On ok the pending counter drops by what the publish saw (never below
-- zero), so edits made during the build stay pending. A failed publish leaves the counter alone.
create function public.record_publish(
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
  v_updated integer;
begin
  if not (select public.is_admin()) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  if p_status not in ('ok', 'failed') then
    raise exception 'INVALID_STATUS';
  end if;

  perform 1 from public.site_state for update;

  update public.publish_log set
    status = p_status,
    finished_at = now(),
    pending_seen = coalesce(p_pending_seen, pending_seen),
    album_count = p_albums,
    photo_count = p_photos,
    snapshot_bytes = p_bytes,
    error = left(p_error, 1000)
  where id = p_log_id and status = 'started';
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'CONFLICT';
  end if;

  if p_status = 'ok' then
    update public.site_state set
      pending_changes = greatest(pending_changes - coalesce(p_pending_seen, 0), 0),
      last_published_at = now();
  end if;

  return jsonb_build_object('ok', true, 'pending_changes', (select pending_changes from public.site_state));
end
$$;
revoke execute on function public.record_publish(uuid, text, integer, integer, integer, bigint, text)
  from public, anon;
grant execute on function public.record_publish(uuid, text, integer, integer, integer, bigint, text)
  to authenticated;

-- Daily ping so the free Supabase project counts as active. Callable by anon (the only such function),
-- writes at most once per 60 seconds and returns no data.
create function public.keepalive() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.keepalive
     set last_ping = now(), pings = pings + 1
   where last_ping is null or last_ping < now() - interval '60 seconds';
  return jsonb_build_object('ok', true);
end
$$;
revoke execute on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
