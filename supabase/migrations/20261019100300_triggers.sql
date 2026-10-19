-- Migration D: triggers. Trigger functions are never callable through the API.

create trigger categories_set_updated_at before update on public.categories
  for each row execute function public.set_updated_at();
create trigger albums_set_updated_at before update on public.albums
  for each row execute function public.set_updated_at();
create trigger photos_set_updated_at before update on public.photos
  for each row execute function public.set_updated_at();

-- Row-level, so a statement that touches zero rows does not count as a change.
create function public.bump_pending() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.site_state set pending_changes = pending_changes + 1;
  return null;
end
$$;
revoke execute on function public.bump_pending() from public, anon, authenticated;

create trigger categories_bump_pending after insert or update or delete on public.categories
  for each row execute function public.bump_pending();
create trigger albums_bump_pending after insert or update or delete on public.albums
  for each row execute function public.bump_pending();
create trigger photos_bump_pending after insert or update or delete on public.photos
  for each row execute function public.bump_pending();
create trigger url_history_bump_pending after insert or update or delete on public.url_history
  for each row execute function public.bump_pending();

-- A cover photo must belong to the album it covers.
create function public.check_album_cover() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cover_photo_id is not null
     and not exists (
       select 1 from public.photos p
       where p.id = new.cover_photo_id and p.album_id = new.id
     ) then
    raise exception 'COVER_NOT_IN_ALBUM' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke execute on function public.check_album_cover() from public, anon, authenticated;

create trigger albums_check_cover before insert or update of cover_photo_id on public.albums
  for each row execute function public.check_album_cover();

-- Moving or deleting the cover photo clears the album's cover instead of failing.
create function public.clear_cover_on_photo_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.album_id is not distinct from old.album_id then
    return new;
  end if;
  update public.albums set cover_photo_id = null where cover_photo_id = old.id;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;
revoke execute on function public.clear_cover_on_photo_change() from public, anon, authenticated;

create trigger photos_clear_cover before delete or update of album_id on public.photos
  for each row execute function public.clear_cover_on_photo_change();
