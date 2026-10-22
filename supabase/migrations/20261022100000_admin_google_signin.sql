-- Migration: admin sign-in with Google only (WP-09, D-16). Single migration (nothing was live).
-- public.admin_emails is the allow-list; public.is_admin() is true only for a confirmed, not banned,
-- not deleted user that has a verified Google identity whose e-mail is on the list and equals the
-- user's e-mail. The old public.admins table (and its policy) is dropped.
-- Dependencies checked: every other policy and function uses public.is_admin(), none reads public.admins.

create table public.admin_emails (
  email text primary key,
  created_at timestamptz not null default now(),
  constraint admin_emails_normalized check (email = lower(btrim(email)) and position('@' in email) > 1)
);

alter table public.admin_emails enable row level security;
revoke all on table public.admin_emails from anon, authenticated;

-- No API role holds a grant, so this policy is never reached; it only states "nobody through the API"
-- explicitly (and keeps the "RLS on means a policy exists" lint rule simple). The definer reads the table.
create policy admin_emails_no_api_access on public.admin_emails
  for all to authenticated
  using (false)
  with check (false);

create or replace function public.is_admin() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join auth.identities i on i.user_id = u.id and i.provider = 'google'
    join public.admin_emails a on a.email = lower(i.identity_data ->> 'email')
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until < now())
      and u.deleted_at is null
      and (i.identity_data ->> 'email_verified') = 'true'
      and lower(u.email) = a.email
  )
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

drop table public.admins;
