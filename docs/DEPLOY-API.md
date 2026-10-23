# Deploying the API Worker (human steps)

Nothing here was run by the builder: no login, no deploy, no real credentials. Steps marked **HUMAN** need Adam in the
Cloudflare or Supabase dashboard or a terminal with his own login. Never paste a secret into chat, a file in the repo, or
`wrangler.toml`. Endpoint contracts are in `docs/API.md`; unverified vendor behaviour is in `docs/VERIFY.md`.

Dashboard menu names below are from memory of the Cloudflare UI and may have moved; the intent of each step is what counts.

## 0. Prerequisites

- **HUMAN** A Cloudflare account with R2 enabled (a payment method may be required to enable R2 even on the free tier; check before relying on a 0 EUR cap).
- **HUMAN** The Supabase project from WP-2 with migrations applied and Adam's Google address in `admin_emails` (a user signs in with Google only; the Google provider and the one-line `insert into public.admin_emails (email) values ('<lowercase address 1>');` are in [ADMIN.md](ADMIN.md#deploying-the-admin-human-steps) step 5, V-1 to V-3; a real address is never written into the repository).
- Node from `.nvmrc`, then `npm ci` in the repo root.

## 1. R2 buckets

**HUMAN** Create one bucket:

| Purpose | Name | Access |
|---------|------|--------|
| Photos and `catalog/published.json` | `mullnyphotos` | public read (custom domain, e.g. `img.mullnyphotos.cz`, or r2.dev for previews only) |

There is no second (backup) bucket and no backup of anything: see [BACKUP.md](BACKUP.md). Nothing here needs a private bucket.
The name must equal `bucket_name` in `apps/api/wrangler.toml` and the `R2_BUCKET` value below.
Choose the location/jurisdiction deliberately and note it in `docs/VERIFY.md` row 6; do not claim EU-only until checked.

## 2. R2 API token (for presigned URLs)

**HUMAN** Create an R2 API token (R2, Manage API tokens):

- Permission: Object Read and Write (presigning needs write; the Worker also lists and deletes objects through its bindings, not this token).
- Scope: specific bucket `mullnyphotos` only. Not account-wide.
- Copy the Access Key ID and Secret Access Key once; they become the secrets `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`.
- Note the Account ID (a 32-character hex string) for `R2_ACCOUNT_ID`.

## 3. Bindings (already in the repo)

`apps/api/wrangler.toml` declares them; no secret is in it:

| Binding | Bucket |
|---------|--------|
| `PHOTOS` | `mullnyphotos` |

Cron: `crons = ["17 3 * * *"]` (daily keepalive, 03:17 UTC). Free-plan availability of cron triggers is `docs/VERIFY.md` row 3.

## 4. Pages deploy hook

**HUMAN** In the Cloudflare Pages (or Workers) project of the public site, create a deploy hook for the production branch
(Settings, Builds, Deploy hooks). The URL is a secret: it becomes `PAGES_DEPLOY_HOOK_URL`. Whether deploy hooks work for
the chosen hosting target is `docs/VERIFY.md` row 2.

## 5. Secrets and configuration

**HUMAN** From `apps/api`, run each command and paste the value when prompted. All nine names are exactly the Worker names
in `.env.example` and `apps/api/src/env.ts`. Everything is set as a secret because secrets survive `wrangler deploy` and
`wrangler.toml` must stay free of values (a gate enforces it).

```
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put R2_BUCKET
npx wrangler secret put R2_PUBLIC_BASE_URL
npx wrangler secret put PAGES_DEPLOY_HOOK_URL
npx wrangler secret put ALLOWED_ORIGINS
```

| Name | Value |
|------|-------|
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` (https only) |
| `SUPABASE_ANON_KEY` | the anon (publishable) key, never the service-role key |
| `R2_ACCOUNT_ID` | 32-character hex account id |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | from step 2 |
| `R2_BUCKET` | `mullnyphotos` |
| `R2_PUBLIC_BASE_URL` | public base of the photo bucket, e.g. `https://img.mullnyphotos.cz` (https, no credentials) |
| `PAGES_DEPLOY_HOOK_URL` | from step 4 |
| `ALLOWED_ORIGINS` | comma-separated exact origins, see below |

`ALLOWED_ORIGINS` is an exact string match: scheme and host (and port), no path, no trailing slash, no wildcard. Examples:

```
https://admin.mullnyphotos.cz
https://admin.mullnyphotos.cz,http://localhost:5173
```

A Pages preview URL changes with every deploy, so it never matches. Decide which stable origin the admin uses (a custom
domain or the stable branch alias) and list only that. Any invalid entry makes every request fail with 500 `CONFIG_ERROR`
(the log names the variable, not the value).

## 6. R2 bucket CORS (photo bucket, for the admin's direct PUT)

**HUMAN** Add this CORS policy to the bucket `mullnyphotos` (bucket Settings, CORS policy), with the same origins as
`ALLOWED_ORIGINS`. `content-length` is set by the browser itself; it is listed only so a strict preflight cannot fail.
The JSON format is the one the dashboard accepts as far as the builder knows (not verified here); if the dashboard
rejects it, use the dashboard form with the same origins, methods and headers.

```json
[
  {
    "AllowedOrigins": ["https://admin.mullnyphotos.cz", "http://localhost:5173"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type", "content-length", "cache-control"],
    "ExposeHeaders": [],
    "MaxAgeSeconds": 3600
  }
]
```

## 7. Recommended: rate-limit rule

**HUMAN** Put the Worker on its own host (e.g. `api.mullnyphotos.cz`) and add a Cloudflare WAF rate-limiting rule on that
host (for example 60 requests per minute per IP, action block). The Worker already refuses non-admins, but a request with
a junk JWT still triggers one Supabase call, so without the rule an attacker can spend that quota. Free-plan availability
of the rule is unverified.

## 8. Deploy

**HUMAN** From `apps/api`:

```
npx wrangler login
npx wrangler deploy
```

Then in the dashboard bind a route or custom domain to the Worker (e.g. `api.mullnyphotos.cz`) and set `VITE_API_BASE_URL`
for the admin build to that origin. Check Workers, Triggers that the cron trigger exists (`docs/VERIFY.md` row 3).

**HUMAN** Hero photo (T-285/T-289): the Worker now reads `site_settings` when publishing, so the chosen home hero only
reaches the public snapshot after (1) migration `20261023110000_hero_photo.sql` is applied live and (2) the Worker is
redeployed (`npx wrangler deploy`). Until then publishing still works and the snapshot has `heroPhotoId: null`. No new
route, binding or secret.

## 9. First live smoke test

**HUMAN** Use a throwaway test photo; take the access token from a signed-in admin session (never share it).

1. `GET https://<api-host>/health` returns 200 `{"ok":true}` without a token. `POST` to it returns 405.
2. `GET /storage` without a token returns 401; with the admin token it returns the quota numbers.
3. Enforcement of content-length (`docs/VERIFY.md` row 4): reserve one small photo through the admin upload screen, but
   PUT one of the signed URLs with a body of a different length than declared (for example with `curl --data-binary`
   and a file of another size). Write down whether R2 rejects it. If R2 accepts it, `POST /uploads/commit` must answer
   422 `KEY_MISMATCH` and the objects must be gone; if it does not, that is a bug to report.
4. Upload one correct photo, commit it, check it appears in the admin and the bucket.
5. Publish from the admin (`POST /publish`). Expect 200 with `counts` and `snapshot_bytes`. Check that
   `https://<R2_PUBLIC_BASE_URL>/catalog/published.json` is the new snapshot and that
   the bucket holds nothing else besides the photos (no backup files).
6. Poll `https://<public-site>/_publish.json` until it shows the new snapshot time (the Pages build runs after the hook).
7. A second publish within 60 s must return 429 `PUBLISH_TOO_SOON`.
8. In the Worker's real-time logs, watch the publish request and note CPU time and the subrequest count for
   `docs/VERIFY.md` row 13. If CPU limits are hit, the first remedy is to skip full validation in the Worker.
9. After 8 or more days, confirm the Supabase project was not paused (`docs/VERIFY.md` row 11).

## Open verification items

`docs/VERIFY.md` rows 2, 3, 4, 6, 11, 12 and 13 are all closed only by the steps above. Nothing may be described as verified
until the evidence is written there.
