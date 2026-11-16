-- Migration: Instagram profile preview data (WP-15, T-357, D-27). Typed by hand, never fetched from Instagram.
-- One row in ig_profile (boolean key, always true): username, display name, bio, link, two counts and an avatar photo.
--   * limits copy Instagram and equal the constants in packages/shared/src/ig.ts: username 30 (letters, digits, dot,
--     underscore), name 64, bio 150, link 200 (empty or http(s)://), counts 0..999999999
--   * avatar_photo_id references photos and is cleared when the photo is deleted (also via delete_photos)
--   * Grants: anon nothing; authenticated may select and update the seven editable columns only (no insert, no
--     delete, no update of id or updated_at); RLS policies use (select public.is_admin())
--   * Deliberately NO bump_pending and NO log_change trigger: like the other ig tables this is not a site change,
--     never in pending_changes, change_log or the snapshot. Only set_updated_at (the optimistic-lock stamp).
--   * Not applied live by the builder (H-1): the human applies it.

create table public.ig_profile (
  id boolean primary key default true,
  username text not null default '',
  display_name text not null default '',
  bio text not null default '',
  link text not null default '',
  followers_count integer not null default 0,
  following_count integer not null default 0,
  avatar_photo_id uuid references public.photos (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint ig_profile_single_row check (id),
  constraint ig_profile_username_length check (char_length(username) <= 30),
  constraint ig_profile_username_chars check (username ~ '^[A-Za-z0-9._]*$'),
  constraint ig_profile_name_length check (char_length(display_name) <= 64),
  constraint ig_profile_bio_length check (char_length(bio) <= 150),
  constraint ig_profile_link_length check (char_length(link) <= 200),
  constraint ig_profile_link_scheme check (link = '' or link ~* '^https?://'),
  constraint ig_profile_followers_range check (followers_count between 0 and 999999999),
  constraint ig_profile_following_range check (following_count between 0 and 999999999)
);

create index ig_profile_avatar_photo_id_idx on public.ig_profile (avatar_photo_id);

insert into public.ig_profile (display_name, username) values ('Mullny Photos', 'mullnyphotos');

-- Only the updated_at trigger; no change-tracking trigger.
create trigger ig_profile_set_updated_at before update on public.ig_profile
  for each row execute function public.set_updated_at();

alter table public.ig_profile enable row level security;

revoke all on table public.ig_profile from public, anon, authenticated;
grant select on table public.ig_profile to authenticated;
grant update (username, display_name, bio, link, followers_count, following_count, avatar_photo_id)
  on table public.ig_profile to authenticated;

create policy ig_profile_admin_select on public.ig_profile
  for select to authenticated using ((select public.is_admin()));

create policy ig_profile_admin_update on public.ig_profile
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
