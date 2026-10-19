-- Migration E5: WP-2 review hardening (T-47). Signatures and grants are unchanged.

-- (1) A variants object with a negative byte size is unusable (null -> BYTES_MISMATCH in register_photo).
create or replace function public.variants_bytes_sum(p_variants jsonb) returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_master bigint;
  v_webp bigint;
  v_jpeg bigint;
  v_og bigint;
  v_bad boolean;
begin
  if jsonb_typeof(p_variants) <> 'object'
     or jsonb_typeof(p_variants -> 'webp') <> 'array'
     or jsonb_array_length(p_variants -> 'webp') < 1 then
    return null;
  end if;
  v_master := (p_variants -> 'master' ->> 'bytes')::bigint;
  v_jpeg := (p_variants -> 'jpeg' ->> 'bytes')::bigint;
  v_og := (p_variants -> 'og' ->> 'bytes')::bigint;
  select sum(b), coalesce(bool_or(b is null or b < 0), true) into v_webp, v_bad
    from (select (e ->> 'bytes')::bigint as b from jsonb_array_elements(p_variants -> 'webp') e) t;
  if v_bad or v_master < 0 or v_jpeg < 0 or v_og < 0 then
    return null;
  end if;
  return v_master + v_webp + v_jpeg + v_og;
exception when others then
  return null;
end
$$;
revoke execute on function public.variants_bytes_sum(jsonb) from public, anon, authenticated;

-- (3a) register_photo: a null id gets a coded error instead of a null-key failure.
create or replace function public.register_photo(
  p_id uuid,
  p_album_id uuid,
  p_width integer,
  p_height integer,
  p_variants jsonb,
  p_bytes_total bigint,
  p_dominant_color text default null,
  p_alt text default null,
  p_legacy_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg public.app_config;
  v_key text;
  v_existing public.photos;
  v_used bigint;
  v_reserved_others bigint;
  v_sort integer;
  v_row public.photos;
begin
  if not (select public.is_admin()) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'INVALID_ID';
  end if;
  v_key := 'photos/' || p_id::text || '/master.jpg';

  perform 1 from public.site_state for update;

  if p_bytes_total is distinct from public.variants_bytes_sum(p_variants) then
    raise exception 'BYTES_MISMATCH';
  end if;

  select * into v_existing from public.photos where id = p_id;
  if found then
    if v_existing.album_id = p_album_id and v_existing.master_key = v_key
       and v_existing.bytes_total = p_bytes_total then
      return to_jsonb(v_existing) || jsonb_build_object('already_existed', true);
    end if;
    raise exception 'CONFLICT';
  end if;

  if p_legacy_key is not null then
    select * into v_existing from public.photos where legacy_key = p_legacy_key;
    if found then
      return to_jsonb(v_existing) || jsonb_build_object('already_existed', true);
    end if;
  end if;

  if not exists (select 1 from public.albums where id = p_album_id) then
    raise exception 'ALBUM_NOT_FOUND';
  end if;

  select * into cfg from public.app_config;
  select coalesce(sum(bytes_total), 0) into v_used from public.photos;
  select coalesce(sum(bytes), 0) into v_reserved_others
    from public.upload_reservations where expires_at > now() and photo_id <> p_id;
  if v_used + v_reserved_others + p_bytes_total > cfg.quota_hard_bytes then
    raise exception 'STORAGE_FULL';
  end if;

  delete from public.upload_reservations where photo_id = p_id;

  select coalesce(max(sort), 0) + 10 into v_sort from public.photos where album_id = p_album_id;

  insert into public.photos (
    id, album_id, master_key, width, height, variants, bytes_total,
    dominant_color, alt, sort, legacy_key
  ) values (
    p_id, p_album_id, v_key, p_width, p_height, p_variants, p_bytes_total,
    p_dominant_color, p_alt, v_sort, p_legacy_key
  ) returning * into v_row;

  return to_jsonb(v_row) || jsonb_build_object('already_existed', false);
end
$$;
revoke execute on function public.register_photo(uuid, uuid, integer, integer, jsonb, bigint, text, text, text)
  from public, anon;
grant execute on function public.register_photo(uuid, uuid, integer, integer, jsonb, bigint, text, text, text)
  to authenticated;

-- (3b) reserve_uploads: malformed items raise INVALID_ITEMS; an id that is already a photo raises CONFLICT.
create or replace function public.reserve_uploads(p_items jsonb) returns jsonb
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
    v_id := null;
    v_bytes := null;
    if jsonb_typeof(v_item) = 'object'
       and jsonb_typeof(v_item -> 'photo_id') = 'string'
       and jsonb_typeof(v_item -> 'bytes') = 'number' then
      begin
        v_id := (v_item ->> 'photo_id')::uuid;
        v_bytes := (v_item ->> 'bytes')::bigint;
      exception when others then
        v_id := null;
        v_bytes := null;
      end;
    end if;
    if v_id is null or v_bytes is null or v_bytes <= 0 then
      raise exception 'INVALID_ITEMS';
    end if;

    if exists (select 1 from public.photos where id = v_id) then
      raise exception 'CONFLICT';
    end if;

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

-- (2) record_publish: the pending counter to subtract comes from the publish_log row written by
-- request_publish; the caller's p_pending_seen is accepted for compatibility and ignored.
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

  perform 1 from public.site_state for update;

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
      last_published_at = now();
  end if;

  return jsonb_build_object('ok', true, 'pending_changes', (select pending_changes from public.site_state));
end
$$;
revoke execute on function public.record_publish(uuid, text, integer, integer, integer, bigint, text)
  from public, anon;
grant execute on function public.record_publish(uuid, text, integer, integer, integer, bigint, text)
  to authenticated;
