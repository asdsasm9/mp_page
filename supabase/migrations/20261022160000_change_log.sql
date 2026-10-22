-- Migration: change_log (T-251, decision D-18 option A). One row per catalog row that differs from the last
-- published site, written by AFTER row triggers next to bump_pending(). The admin "Zobrazit zmeny" dialog
-- lists these rows and the publish screen counts them, so the number and the lines can never disagree.
--
-- Rules the trigger applies (a row is identified by table_name + row_id, at most one row per key):
--   * insert                -> 'added'
--   * delete                -> 'deleted'; a row that was only added since the last publish disappears
--                              from the log instead (net change zero)
--   * update, only sort     -> 'reordered'
--   * update, other columns -> 'edited'
--   * update that changes nothing but updated_at is not logged
--   * further changes to a logged row refresh it (time, label, context) instead of adding lines;
--     added stays added, reordered becomes edited when something else changes too
--   * url_history is NOT logged: its rows are written by the slug and delete triggers of albums and
--     categories, which are already logged as edited or deleted, so a line would only repeat them.
-- bump_pending() and site_state.pending_changes are unchanged (publish bookkeeping); the admin UI counts
-- change_log rows instead.
--
-- Clearing: record_publish(status ok) deletes every row with at <= the publish request time of that
-- publish_log row. Edits made while the build runs (at later than the request) stay listed, the same way
-- the counter keeps them. A timestamp filter on last_published_at would drop those, so rows are deleted.

create table public.change_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  table_name text not null,
  row_id uuid not null,
  kind text not null,
  -- Name at change time: category name, album title, photo alt text (else caption, else empty).
  label text not null default '',
  -- Grouping context at change time. No foreign keys: the rows may be deleted later.
  category_id uuid,
  category_name text,
  album_id uuid,
  album_title text,
  constraint change_log_table_name check (table_name in ('categories', 'albums', 'photos')),
  constraint change_log_kind check (kind in ('added', 'edited', 'deleted', 'reordered')),
  constraint change_log_row_unique unique (table_name, row_id)
);

create index change_log_at_idx on public.change_log (at);

alter table public.change_log enable row level security;
revoke all on table public.change_log from public, anon, authenticated;
grant select on table public.change_log to authenticated;

-- Admins read; nobody writes through the API (only the trigger function and record_publish, as owner).
create policy change_log_admin_select on public.change_log
  for select to authenticated using ((select public.is_admin()));

create function public.log_change() returns trigger
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
  v_id := (v_row ->> 'id')::uuid;

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

create trigger categories_log_change after insert or update or delete on public.categories
  for each row execute function public.log_change();
create trigger albums_log_change after insert or update or delete on public.albums
  for each row execute function public.log_change();
create trigger photos_log_change after insert or update or delete on public.photos
  for each row execute function public.log_change();

-- record_publish as in 20261022150000 (pg-safeupdate WHERE clauses), plus: a successful publish clears the
-- change log up to the moment the publish was requested.
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
  v_requested_at timestamptz;
begin
  if not (select public.is_admin()) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  if p_status not in ('ok', 'failed') then
    raise exception 'INVALID_STATUS';
  end if;

  perform 1 from public.site_state where id for update;

  select pending_seen, requested_at into v_seen, v_requested_at from public.publish_log
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
    delete from public.change_log where at <= v_requested_at;
  end if;

  return jsonb_build_object('ok', true, 'pending_changes', (select pending_changes from public.site_state where id));
end
$$;
revoke execute on function public.record_publish(uuid, text, integer, integer, integer, bigint, text)
  from public, anon;
grant execute on function public.record_publish(uuid, text, integer, integer, integer, bigint, text)
  to authenticated;
