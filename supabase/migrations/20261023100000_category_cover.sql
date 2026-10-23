-- Migration: category cover photo (T-271). A category may have a main photo chosen by the photographer.
-- Null means "automatic" (the public site falls back to the first album's cover).
--   * the photo must belong to an album of this category (published or not), else CATEGORY_COVER_NOT_IN_CATEGORY
--   * deleting the photo, moving it to an album of another category, or moving its album to another category
--     clears the choice instead of failing
-- Grants and RLS of public.categories already cover the new column (table-level grant, categories_admin_all).
-- change_log: a change of the column is an 'edited' line for the category (log_change compares whole rows);
-- bump_pending fires as for any categories update.

alter table public.categories
  add column cover_photo_id uuid references public.photos (id) on delete set null;

create index categories_cover_photo_id_idx on public.categories (cover_photo_id);

create function public.check_category_cover() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cover_photo_id is not null
     and not exists (
       select 1 from public.photos p
       join public.albums a on a.id = p.album_id
       where p.id = new.cover_photo_id and a.category_id = new.id
     ) then
    raise exception 'CATEGORY_COVER_NOT_IN_CATEGORY' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke execute on function public.check_category_cover() from public, anon, authenticated;

-- Named so it sorts before categories_log_change (triggers fire in name order).
create trigger categories_check_cover before insert or update of cover_photo_id on public.categories
  for each row execute function public.check_category_cover();

-- Deleting a photo, or moving it to an album of another category, clears the category cover that points at it.
-- A move inside the same category keeps it.
create function public.clear_category_cover_on_photo_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.album_id is not distinct from old.album_id then
      return new;
    end if;
    update public.categories c set cover_photo_id = null
     where c.cover_photo_id = old.id
       and not exists (select 1 from public.albums a where a.id = new.album_id and a.category_id = c.id);
    return new;
  end if;
  update public.categories set cover_photo_id = null where cover_photo_id = old.id;
  return old;
end
$$;
revoke execute on function public.clear_category_cover_on_photo_change() from public, anon, authenticated;

create trigger photos_clear_category_cover before delete or update of album_id on public.photos
  for each row execute function public.clear_category_cover_on_photo_change();

-- Moving an album to another category clears the old category's cover when it was a photo of that album.
create function public.clear_category_cover_on_album_move() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.categories c set cover_photo_id = null
   where c.id = old.category_id
     and c.cover_photo_id in (select p.id from public.photos p where p.album_id = new.id);
  return null;
end
$$;
revoke execute on function public.clear_category_cover_on_album_move() from public, anon, authenticated;

create trigger albums_clear_category_cover after update of category_id on public.albums
  for each row when (old.category_id is distinct from new.category_id)
  execute function public.clear_category_cover_on_album_move();
