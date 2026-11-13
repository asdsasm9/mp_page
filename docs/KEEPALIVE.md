# Keepalive for the Supabase project

## Why

The free Supabase project `mullny-photos` pauses after a period without activity. A paused project takes the admin
down. The GitHub workflow `.github/workflows/keepalive.yml` calls the database function `public.ping()` every 3 days
(plus on demand with "Run workflow"). The function returns `ok`, touches no table and is callable by anon.

The job fails unless the REST call answers HTTP 200, so a paused project shows up as a red run (and a GitHub
notification). Its second step re-enables the workflow, because GitHub switches off scheduled workflows after 60 days
without repository activity.

## Secrets

Add them under GitHub, repository Settings, Secrets and variables, Actions:

| Secret | Value |
| --- | --- |
| `SUPABASE_URL` | the project URL, `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | the project's public anon key |

Neither value is stored in the repository. The workflow reads them only through the `secrets` context.

## Setup

1. Apply the migration `supabase/migrations/20261113100000_ping.sql` to the project.
2. Add the two secrets.
3. Run the Keepalive workflow once by hand and confirm it is green.

## Fallback

A free external pinger works too, for example cron-job.org: a job every 3 days or more often, method POST, URL
`<SUPABASE_URL>/rest/v1/rpc/ping`, headers `apikey: <anon key>`, `Authorization: Bearer <anon key>` and
`Content-Type: application/json`, body `{}`. Enable "notify on failure".
