-- Migration B: catalog tables (categories, albums, photos, url_history).
-- Grants follow WP-2 section 3.2 as tightened by decision D-5:
--   photos: authenticated gets select plus a column-limited update only (no insert, no delete);
--   rows are created and removed through the register_photo and delete_photos functions.

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  seo_title text,
  seo_description text,
  sort integer not null default 0,
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint categories_slug_length check (char_length(slug) between 2 and 60),
  constraint categories_slug_not_reserved check (slug <> all (array[
    'portfolio', 'o-mne', 'kontakt', '404', 'admin', 'api', 'img', 'assets', '_astro',
    'fotky_web', 'sitemap', 'robots', 'cookies', 'ochrana-udaju'
  ])),
  constraint categories_name_length check (char_length(name) between 1 and 80),
  constraint categories_seo_title_length check (char_length(seo_title) <= 120),
  constraint categories_seo_description_length check (char_length(seo_description) <= 300)
);

create table public.albums (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete restrict,
  slug text not null unique,
  title text not null,
  place text,
  shot_on date,
  description text,
  seo_title text,
  seo_description text,
  cover_photo_id uuid,
  sort integer not null default 0,
  published boolean not null default false,
  legacy_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint albums_slug_format check (slug ~ '^[a-z0-9]+([-_][a-z0-9]+)*$'),
  constraint albums_slug_length check (char_length(slug) between 2 and 60),
  constraint albums_title_length check (char_length(title) between 1 and 120),
  constraint albums_seo_title_length check (char_length(seo_title) <= 120),
  constraint albums_seo_description_length check (char_length(seo_description) <= 300)
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums (id) on delete restrict,
  master_key text not null unique,
  width integer not null,
  height integer not null,
  variants jsonb not null,
  bytes_total bigint not null,
  dominant_color text,
  alt text,
  caption text,
  sort integer not null default 0,
  legacy_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint photos_master_key_matches_id check (master_key = 'photos/' || id::text || '/master.jpg'),
  constraint photos_size_positive check (width > 0 and height > 0),
  constraint photos_variants_object check (jsonb_typeof(variants) = 'object'),
  constraint photos_bytes_total_nonneg check (bytes_total >= 0),
  constraint photos_dominant_color_format check (dominant_color ~ '^#[0-9a-f]{6}$'),
  constraint photos_alt_length check (char_length(alt) <= 300),
  constraint photos_caption_length check (char_length(caption) <= 500)
);

-- albums.cover_photo_id points at photos, which are created after albums.
alter table public.albums
  add constraint albums_cover_photo_fk
  foreign key (cover_photo_id) references public.photos (id) on delete set null;

create table public.url_history (
  id uuid primary key default gen_random_uuid(),
  old_path text not null unique,
  target text,
  status integer not null,
  created_at timestamptz not null default now(),
  constraint url_history_status check (status in (301, 410))
);

create index albums_category_id_idx on public.albums (category_id);
create index photos_album_id_idx on public.photos (album_id);
create index albums_cover_photo_id_idx on public.albums (cover_photo_id);

-- RLS on everything.
alter table public.categories enable row level security;
alter table public.albums enable row level security;
alter table public.photos enable row level security;
alter table public.url_history enable row level security;

-- Explicit grants: start from nothing.
revoke all on table public.categories, public.albums, public.photos, public.url_history
  from anon, authenticated;

grant select, insert, update, delete on table public.categories to authenticated;
grant select, insert, update, delete on table public.albums to authenticated;
grant select, insert, update, delete on table public.url_history to authenticated;
grant select on table public.photos to authenticated;
grant update (album_id, sort, alt, caption) on table public.photos to authenticated;

-- Policies: only admins, on every command that is granted.
create policy categories_admin_all on public.categories
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy albums_admin_all on public.albums
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy url_history_admin_all on public.url_history
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy photos_admin_select on public.photos
  for select to authenticated
  using ((select public.is_admin()));

create policy photos_admin_update on public.photos
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
