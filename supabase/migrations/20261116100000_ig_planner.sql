-- Migration: Instagram planning grid (WP-14, T-343). Planning only, no Instagram or Meta call.
-- Two tables: ig_posts (one planned or posted Instagram post) and ig_post_photos (the 1..10 photos of a post,
-- in carousel order; position 1 is the grid tile). Photos are only referenced, never copied.
--   * RLS and grants like the catalog tables: admins have full access, anon has nothing.
--   * Deliberately NO bump_pending and NO log_change trigger: planner edits are not site changes, never show up
--     as pending changes for "Zverejnit web" and are not part of the published snapshot. change_log_table_name,
--     log_change and record_publish are untouched.
--   * Deleting a photo (also through delete_photos) cascades the photo out of every post; remaining photos keep
--     their sort (gaps are fine). A post left with no photos stays; the app treats it as a draft.
--   * At most 10 photos per post: sort check (1..10) plus unique (post_id, sort); at least 1 is enforced by the RPC.
-- Error codes of ig_set_post_photos: NOT_ADMIN (42501), IG_PHOTOS_INVALID (23514, bad list: null, empty, more than
-- 10, duplicate or null ids), IG_POST_NOT_FOUND and IG_PHOTO_NOT_FOUND (23503).

create table public.ig_posts (
  id uuid primary key default gen_random_uuid(),
  caption text not null default '',
  hashtags text not null default '',
  planned_on date,
  status text not null default 'draft',
  posted_at timestamptz,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ig_posts_status check (status in ('draft', 'planned', 'posted')),
  constraint ig_posts_caption_length check (char_length(caption) <= 2200),
  constraint ig_posts_hashtags_length check (char_length(hashtags) <= 2200),
  constraint ig_posts_posted_matches_status check ((status = 'posted') = (posted_at is not null))
);

create index ig_posts_status_sort_idx on public.ig_posts (status, sort);
create index ig_posts_posted_at_idx on public.ig_posts (posted_at);

create table public.ig_post_photos (
  post_id uuid not null references public.ig_posts (id) on delete cascade,
  photo_id uuid not null references public.photos (id) on delete cascade,
  sort integer not null,
  primary key (post_id, photo_id),
  constraint ig_post_photos_sort_range check (sort between 1 and 10),
  constraint ig_post_photos_post_sort_key unique (post_id, sort) deferrable initially immediate
);

create index ig_post_photos_photo_id_idx on public.ig_post_photos (photo_id);

-- Only the updated_at trigger; no change-tracking trigger on either table.
create trigger ig_posts_set_updated_at before update on public.ig_posts
  for each row execute function public.set_updated_at();

alter table public.ig_posts enable row level security;
alter table public.ig_post_photos enable row level security;

revoke all on table public.ig_posts, public.ig_post_photos from anon, authenticated;
grant select, insert, update, delete on table public.ig_posts to authenticated;
grant select, insert, update, delete on table public.ig_post_photos to authenticated;

create policy ig_posts_admin_all on public.ig_posts
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy ig_post_photos_admin_all on public.ig_post_photos
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Atomic replace of the photo set of a post; the order of p_photo_ids becomes sort 1..n.
create function public.ig_set_post_photos(p_post_id uuid, p_photo_ids uuid[]) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;

  if p_photo_ids is null
     or coalesce(cardinality(p_photo_ids), 0) not between 1 and 10
     or exists (select 1 from unnest(p_photo_ids) as x (id) where x.id is null)
     or (select count(distinct x.id) from unnest(p_photo_ids) as x (id)) <> cardinality(p_photo_ids) then
    raise exception 'IG_PHOTOS_INVALID' using errcode = '23514';
  end if;

  perform 1 from public.ig_posts where id = p_post_id for update;
  if not found then
    raise exception 'IG_POST_NOT_FOUND' using errcode = '23503';
  end if;

  if (select count(*) from public.photos where id = any (p_photo_ids)) <> cardinality(p_photo_ids) then
    raise exception 'IG_PHOTO_NOT_FOUND' using errcode = '23503';
  end if;

  delete from public.ig_post_photos where post_id = p_post_id;

  insert into public.ig_post_photos (post_id, photo_id, sort)
  select p_post_id, t.id, t.n::integer
    from unnest(p_photo_ids) with ordinality as t (id, n);

  update public.ig_posts set updated_at = now() where id = p_post_id;
end
$$;
revoke execute on function public.ig_set_post_photos(uuid, uuid[]) from public, anon;
grant execute on function public.ig_set_post_photos(uuid, uuid[]) to authenticated;
