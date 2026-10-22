-- Migration E2: register_photo() and delete_photos(). Decision D-5: authenticated users have no
-- insert or delete on public.photos, so these two functions are the only way the stored total changes.

-- Sum of the byte sizes inside a variants object; null when the shape is not usable.
create function public.variants_bytes_sum(p_variants jsonb) returns bigint
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(p_variants) <> 'object'
     or jsonb_typeof(p_variants -> 'webp') <> 'array'
     or jsonb_array_length(p_variants -> 'webp') < 1 then
    return null;
  end if;
  return (p_variants -> 'master' ->> 'bytes')::bigint
       + (select sum((e ->> 'bytes')::bigint) from jsonb_array_elements(p_variants -> 'webp') e)
       + (p_variants -> 'jpeg' ->> 'bytes')::bigint
       + (p_variants -> 'og' ->> 'bytes')::bigint;
exception when others then
  return null;
end
$$;
revoke execute on function public.variants_bytes_sum(jsonb) from public, anon, authenticated;

create function public.register_photo(
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
  v_key text := 'photos/' || p_id::text || '/master.jpg';
  v_existing public.photos;
  v_used bigint;
  v_reserved_others bigint;
  v_sort integer;
  v_row public.photos;
begin
  if not (select public.is_admin()) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;

  perform 1 from public.site_state for update;

  if p_bytes_total is distinct from public.variants_bytes_sum(p_variants) then
    raise exception 'BYTES_MISMATCH';
  end if;

  -- Idempotent: the same id (same album and size) or a known legacy key returns the stored row.
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

  -- Quota backstop: counts other people's live reservations, ignores the caller's own.
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

-- Deletes rows and returns what was deleted; the Worker removes the R2 objects afterwards.
create function public.delete_photos(p_ids uuid[]) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted jsonb;
begin
  if not (select public.is_admin()) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;

  perform 1 from public.site_state for update;

  with gone as (
    delete from public.photos where id = any (coalesce(p_ids, '{}'::uuid[]))
    returning id, master_key
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'master_key', master_key) order by id), '[]'::jsonb)
    into v_deleted from gone;

  return jsonb_build_object('deleted', v_deleted);
end
$$;
revoke execute on function public.delete_photos(uuid[]) from public, anon;
grant execute on function public.delete_photos(uuid[]) to authenticated;
