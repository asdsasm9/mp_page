-- Migration E1: storage_usage() and reserve_uploads(). Quota is computed from the data, never stored:
--   used = sum(photos.bytes_total), reserved = sum of unexpired upload_reservations.bytes.

create function public.storage_usage() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg public.app_config;
  v_used bigint;
  v_reserved bigint;
  v_count bigint;
begin
  if not (select public.is_admin()) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  select * into cfg from public.app_config;
  select coalesce(sum(bytes_total), 0), count(*) into v_used, v_count from public.photos;
  select coalesce(sum(bytes), 0) into v_reserved from public.upload_reservations where expires_at > now();
  return jsonb_build_object(
    'used_bytes', v_used,
    'reserved_bytes', v_reserved,
    'hard', cfg.quota_hard_bytes,
    'warn', cfg.quota_warn_bytes,
    'photo_count', v_count,
    'level', case
      when v_used + v_reserved >= cfg.quota_hard_bytes then 'full'
      when v_used + v_reserved >= cfg.quota_warn_bytes then 'warn'
      else 'ok'
    end
  );
end
$$;
revoke execute on function public.storage_usage() from public, anon;
grant execute on function public.storage_usage() to authenticated;

-- Batch quota guard. Input: [{photo_id, bytes}]. Refused items consume nothing (first-fit); the
-- result lists every item. Mirrors planBatch in @mp/shared. Serialised through a lock on site_state.
create function public.reserve_uploads(p_items jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg public.app_config;
  v_used bigint;
  v_reserved bigint;
  v_item jsonb;
  v_id uuid;
  v_bytes bigint;
  v_old bigint;
  v_results jsonb := '[]'::jsonb;
begin
  if not (select public.is_admin()) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;

  perform 1 from public.site_state for update;

  delete from public.upload_reservations where expires_at <= now();

  select * into cfg from public.app_config;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'INVALID_ITEMS';
  end if;
  if jsonb_array_length(p_items) > cfg.max_files_per_batch then
    raise exception 'BATCH_TOO_LARGE';
  end if;

  select coalesce(sum(bytes_total), 0) into v_used from public.photos;
  select coalesce(sum(bytes), 0) into v_reserved from public.upload_reservations;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_id := (v_item ->> 'photo_id')::uuid;
    v_bytes := (v_item ->> 'bytes')::bigint;
    if v_id is null or v_bytes is null or v_bytes <= 0 then
      raise exception 'INVALID_ITEMS';
    end if;

    -- Re-reserving the same photo replaces its earlier reservation.
    delete from public.upload_reservations where photo_id = v_id returning bytes into v_old;
    if v_old is not null then
      v_reserved := v_reserved - v_old;
      v_old := null;
    end if;

    if v_bytes > cfg.max_upload_bytes then
      v_results := v_results || jsonb_build_object('photo_id', v_id, 'ok', false, 'code', 'FILE_TOO_LARGE');
    elsif v_used + v_reserved + v_bytes > cfg.quota_hard_bytes then
      v_results := v_results || jsonb_build_object('photo_id', v_id, 'ok', false, 'code', 'STORAGE_FULL');
    else
      insert into public.upload_reservations (photo_id, requested_by, bytes, expires_at)
        values (v_id, (select auth.uid()), v_bytes, now() + make_interval(mins => cfg.reservation_ttl_min));
      v_reserved := v_reserved + v_bytes;
      v_results := v_results || jsonb_build_object('photo_id', v_id, 'ok', true);
    end if;
  end loop;

  return jsonb_build_object(
    'results', v_results,
    'used_bytes', v_used,
    'reserved_bytes', v_reserved,
    'hard', cfg.quota_hard_bytes,
    'warn', cfg.quota_warn_bytes,
    'level', case
      when v_used + v_reserved >= cfg.quota_hard_bytes then 'full'
      when v_used + v_reserved >= cfg.quota_warn_bytes then 'warn'
      else 'ok'
    end
  );
end
$$;
revoke execute on function public.reserve_uploads(jsonb) from public, anon;
grant execute on function public.reserve_uploads(jsonb) to authenticated;
