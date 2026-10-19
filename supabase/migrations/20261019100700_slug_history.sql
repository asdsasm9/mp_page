-- Migration F (slippable): slug history. Keeps old public URLs alive in public.url_history:
--   album slug or category change  -> 301 from /<cat>/<old>/ to the new path
--   category slug change           -> 301 for the category page /<old>/ and for each of its albums
--   album deleted                  -> 410 for /<cat>/<slug>/
-- The trigger functions are never callable through the API. Additive: no earlier object is changed.

-- Records one redirect, repoints older redirects that ended at the old path (no chains), and drops a
-- stale entry for the new path (renaming back to a former slug must not redirect away from itself).
create function public.record_slug_redirect(p_old text, p_new text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_old is null or p_new is null or p_old = p_new then
    return;
  end if;
  delete from public.url_history where old_path = p_new;
  update public.url_history set target = p_new where target = p_old and status = 301;
  insert into public.url_history (old_path, target, status) values (p_old, p_new, 301)
    on conflict (old_path) do update set target = excluded.target, status = 301;
end
$$;
revoke execute on function public.record_slug_redirect(text, text) from public, anon, authenticated;

create function public.albums_slug_history() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_cat text;
  v_new_cat text;
begin
  if new.slug is not distinct from old.slug and new.category_id is not distinct from old.category_id then
    return null;
  end if;
  select slug into v_old_cat from public.categories where id = old.category_id;
  select slug into v_new_cat from public.categories where id = new.category_id;
  perform public.record_slug_redirect(
    '/' || v_old_cat || '/' || old.slug || '/',
    '/' || v_new_cat || '/' || new.slug || '/'
  );
  return null;
end
$$;
revoke execute on function public.albums_slug_history() from public, anon, authenticated;

create trigger albums_slug_history after update of slug, category_id on public.albums
  for each row execute function public.albums_slug_history();

create function public.categories_slug_history() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_album record;
begin
  if new.slug is not distinct from old.slug then
    return null;
  end if;
  perform public.record_slug_redirect('/' || old.slug || '/', '/' || new.slug || '/');
  for v_album in select slug from public.albums where category_id = new.id order by slug loop
    perform public.record_slug_redirect(
      '/' || old.slug || '/' || v_album.slug || '/',
      '/' || new.slug || '/' || v_album.slug || '/'
    );
  end loop;
  return null;
end
$$;
revoke execute on function public.categories_slug_history() from public, anon, authenticated;

create trigger categories_slug_history after update of slug on public.categories
  for each row execute function public.categories_slug_history();

-- A deleted album answers 410 Gone (and replaces any redirect that used to start at its path).
create function public.albums_delete_history() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat text;
begin
  select slug into v_cat from public.categories where id = old.category_id;
  if v_cat is null then
    return null;
  end if;
  insert into public.url_history (old_path, target, status)
    values ('/' || v_cat || '/' || old.slug || '/', null, 410)
    on conflict (old_path) do update set target = null, status = 410;
  return null;
end
$$;
revoke execute on function public.albums_delete_history() from public, anon, authenticated;

create trigger albums_delete_history after delete on public.albums
  for each row execute function public.albums_delete_history();
