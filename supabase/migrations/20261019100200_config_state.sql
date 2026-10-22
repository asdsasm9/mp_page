-- Migration C: configuration and state tables. Authenticated admins may only read them;
-- all writes go through security definer functions (later migrations) or the database owner.

create table public.app_config (
  id boolean primary key default true,
  quota_hard_bytes bigint not null default 9500000000,
  quota_warn_bytes bigint not null default 8000000000,
  max_upload_bytes bigint not null default 41943040,
  max_files_per_batch integer not null default 200,
  reservation_ttl_min integer not null default 60,
  constraint app_config_single_row check (id),
  constraint app_config_quota_order check (
    quota_warn_bytes > 0 and quota_warn_bytes <= quota_hard_bytes and quota_hard_bytes <= 10000000000
  ),
  constraint app_config_max_upload_positive check (max_upload_bytes > 0),
  constraint app_config_batch_positive check (max_files_per_batch > 0),
  constraint app_config_ttl_positive check (reservation_ttl_min > 0)
);

create table public.site_state (
  id boolean primary key default true,
  pending_changes integer not null default 0,
  last_published_at timestamptz,
  last_publish_requested_at timestamptz,
  constraint site_state_single_row check (id),
  constraint site_state_pending_nonneg check (pending_changes >= 0)
);

create table public.publish_log (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid,
  requested_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'started',
  pending_seen integer,
  album_count integer,
  photo_count integer,
  snapshot_bytes bigint,
  error text,
  constraint publish_log_status check (status in ('started', 'ok', 'failed'))
);

create table public.upload_reservations (
  photo_id uuid primary key,
  requested_by uuid,
  bytes bigint not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint upload_reservations_bytes_positive check (bytes > 0)
);

create index upload_reservations_expires_at_idx on public.upload_reservations (expires_at);

create table public.keepalive (
  id boolean primary key default true,
  last_ping timestamptz,
  pings bigint not null default 0,
  constraint keepalive_single_row check (id)
);

insert into public.app_config default values;
insert into public.site_state default values;
insert into public.keepalive default values;

alter table public.app_config enable row level security;
alter table public.site_state enable row level security;
alter table public.publish_log enable row level security;
alter table public.upload_reservations enable row level security;
alter table public.keepalive enable row level security;

revoke all on table
  public.app_config, public.site_state, public.publish_log,
  public.upload_reservations, public.keepalive
  from anon, authenticated;

grant select on table
  public.app_config, public.site_state, public.publish_log, public.upload_reservations
  to authenticated;

create policy app_config_admin_select on public.app_config
  for select to authenticated using ((select public.is_admin()));

create policy site_state_admin_select on public.site_state
  for select to authenticated using ((select public.is_admin()));

create policy publish_log_admin_select on public.publish_log
  for select to authenticated using ((select public.is_admin()));

create policy upload_reservations_admin_select on public.upload_reservations
  for select to authenticated using ((select public.is_admin()));

-- keepalive has no grant for any API role; the policy exists so RLS is never policy-less,
-- and it matches nothing. The keepalive() function (later migration) is the only writer.
create policy keepalive_no_direct_access on public.keepalive
  for select to authenticated using (false);
