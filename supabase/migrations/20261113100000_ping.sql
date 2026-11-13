-- Migration: public.ping(), a read-only liveness call for the GitHub keepalive workflow (T-340).
-- It touches no table, so it needs no security definer; the REST request itself counts as project activity.
-- Callable by anon (with keepalive(), the only such functions) and by authenticated.
create function public.ping() returns text
language sql
stable
set search_path = ''
as $$ select 'ok'::text $$;
revoke execute on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
