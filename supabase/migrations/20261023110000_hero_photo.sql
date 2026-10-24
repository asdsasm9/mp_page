-- Migration: home hero photo (T-285). The photographer may choose the photo shown in the hero of the home page.
-- One row in site_settings; hero_photo_id null means "automatic" (the public site shows the bundled main.jpg).
--   * the photo must exist, else HERO_PHOTO_NOT_FOUND (SQLSTATE 23503); it may be in an unpublished album or a
--     hidden category: the snapshot builder simply does not expose such a choice
--   * deleting the photo (also through a cascade from its album) clears the choice (on delete set null)
-- Grants: anon nothing; authenticated may select and update hero_photo_id only (no insert, no delete).
-- Change log: log_change is replaced (create or replace) to know the new table, with kind 'edited' and the label
-- "Hlavni fotka uvodni stranky" (written with its Czech diacritics below). change_log.row_id is a uuid but the
-- single settings row has a boolean key, so it is logged under one fixed uuid.
-- bump_pending fires as for the catalog tables.

create table public.site_settings (
  id boolean primary key default true,
  hero_photo_id uuid references public.photos (id) on delete set null,
  constraint site_settings_single_row check (id)
);

insert into public.site_settings default values;

create index site_settings_hero_photo_id_idx on public.site_settings (hero_photo_id);

alter table public.site_settings enable row level security;

revoke all on table public.site_settings from public, anon, authenticated;
grant select on table public.site_settings to authenticated;
grant update (hero_photo_id) on table public.site_settings to authenticated;

create policy site_settings_admin_select on public.site_settings
  for select to authenticated using ((select public.is_admin()));

create policy site_settings_admin_update on public.site_settings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create function public.check_hero_photo() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.hero_photo_id is not null
     and not exists (select 1 from public.photos p where p.id = new.hero_photo_id) then
    raise exception 'HERO_PHOTO_NOT_FOUND' using errcode = '23503';
  end if;
  return new;
end
$$;
revoke execute on function public.check_hero_photo() from public, anon, authenticated;

create trigger site_settings_check_hero before insert or update of hero_photo_id on public.site_settings
  for each row execute function public.check_hero_photo();

create trigger site_settings_bump_pending after insert or update or delete on public.site_settings
  for each row execute function public.bump_pending();

-- change_log: allow the new table name.
alter table public.change_log drop constraint change_log_table_name;
alter table public.change_log add constraint change_log_table_name
  check (table_name in ('categories', 'albums', 'photos', 'site_settings'));

-- log_change as in 20261022160000_change_log.sql plus the site_settings branch.
create or replace function public.log_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_id uuid;
  v_kind text;
  v_label text;
  v_cat_id uuid;
  v_cat_name text;
  v_alb_id uuid;
  v_alb_title text;
  v_old public.change_log;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;
  if tg_table_name = 'site_settings' then
    v_id := '00000000-0000-4000-8000-000000000001'::uuid;
  else
    v_id := (v_row ->> 'id')::uuid;
  end if;

  if tg_op = 'INSERT' then
    v_kind := 'added';
  elsif tg_op = 'DELETE' then
    v_kind := 'deleted';
  elsif (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
    return null;
  elsif (to_jsonb(new) - 'updated_at' - 'sort') = (to_jsonb(old) - 'updated_at' - 'sort') then
    v_kind := 'reordered';
  else
    v_kind := 'edited';
  end if;

  if tg_table_name = 'categories' then
    v_label := v_row ->> 'name';
    v_cat_id := v_id;
    v_cat_name := v_label;
  elsif tg_table_name = 'albums' then
    v_label := v_row ->> 'title';
    v_alb_id := v_id;
    v_alb_title := v_label;
    v_cat_id := (v_row ->> 'category_id')::uuid;
    select c.name into v_cat_name from public.categories c where c.id = v_cat_id;
  elsif tg_table_name = 'site_settings' then
    v_label := 'Hlavní fotka úvodní stránky';
  else
    v_label := coalesce(nullif(btrim(v_row ->> 'alt'), ''), nullif(btrim(v_row ->> 'caption'), ''), '');
    v_alb_id := (v_row ->> 'album_id')::uuid;
    select a.title, a.category_id into v_alb_title, v_cat_id from public.albums a where a.id = v_alb_id;
    select c.name into v_cat_name from public.categories c where c.id = v_cat_id;
  end if;

  select * into v_old from public.change_log where table_name = tg_table_name and row_id = v_id;

  if not found then
    insert into public.change_log (table_name, row_id, kind, label, category_id, category_name, album_id, album_title)
      values (tg_table_name, v_id, v_kind, v_label, v_cat_id, v_cat_name, v_alb_id, v_alb_title);
  elsif v_kind = 'deleted' and v_old.kind = 'added' then
    delete from public.change_log where id = v_old.id;
  else
    update public.change_log set
      at = now(),
      kind = case
        when v_kind = 'deleted' then 'deleted'
        when v_old.kind = 'deleted' then 'edited'
        when v_old.kind = 'added' then 'added'
        when v_old.kind = 'reordered' then v_kind
        else 'edited'
      end,
      label = v_label,
      category_id = v_cat_id,
      category_name = v_cat_name,
      album_id = v_alb_id,
      album_title = v_alb_title
    where id = v_old.id;
  end if;
  return null;
end
$$;
revoke execute on function public.log_change() from public, anon, authenticated;

create trigger site_settings_log_change after insert or update or delete on public.site_settings
  for each row execute function public.log_change();
