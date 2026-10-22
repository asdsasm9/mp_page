# Maintenance (for Adam)

The photographer runs the site herself; adding photos after a shoot is the only routine task. The public site is static, so it keeps serving when Supabase, the Worker or the admin break. Nothing here needs a schedule except the domain and one quarterly check. Nothing below was run against a live service. Platform facts not yet read from vendor documentation are marked TO VERIFY with the row in [VERIFY.md](VERIFY.md).

## What can need attention

| Trigger | Symptom | What to do | Who | Time |
|---------|---------|------------|-----|------|
| Domain renewal (yearly) | Registrar mail, or the domain lapses and site, admin and mail all stop | Renew at the registrar and check the payment method; note the expiry date for the quarterly check | Adam | 10 min a year |
| Supabase free project pauses | Admin shows its Czech notice or errors; the public site is unaffected. Pause rules and the exact admin text: TO VERIFY ([row 11](VERIFY.md), [row 30](VERIFY.md)) | Unpause in the Supabase dashboard, wait until it is up, sign in to the admin. No restore needed: [situation 1](BACKUP.md#situation-1-supabase-is-paused) | Adam | 5 min |
| Daily keepalive cron fails | Nothing visible: failures are only logged (`KEEPALIVE_FAILED`), silent by design ([API.md](API.md#scheduled-handler-cron)). Seen in the Cloudflare dashboard or when Supabase pauses. Whether free-plan cron and keepalive count as activity: TO VERIFY ([row 3](VERIFY.md), [row 11](VERIFY.md)) | Glance at the Worker in the quarterly check; if it fails, follow [DEPLOY-API.md](DEPLOY-API.md) (Triggers tab) | Adam | 5 min |
| Storage nears 8 GB | Admin storage bar warns at 8 GB; uploads are refused at 9.5 GB. Whether "GB" is decimal: TO VERIFY ([row 14](VERIFY.md)) | The guard stops it, nothing happens silently ([limits](API.md#limits)). Adam and the photographer decide: delete old photos, run "Zkontrolovat úložiště" (reconcile) to clear leftovers, or approve a paid R2 tier (breaks the 0 EUR cap, so only Adam approves). Residual risk: the guard counts only the photo bucket's registered photos and reservations, not unreconciled orphans, so keep about 500 MB headroom below 10 GB | Adam, photographer | 15 min |
| Cloudflare Pages build fails | Publish never shows the new time in `/_publish.json`; the admin reports a timeout. Free-plan build limits: TO VERIFY ([row 7](VERIFY.md)) | The previous deploy stays live. Read the build log in the Pages project. Usual causes: the snapshot is invalid or unreachable, no album is published, a `PUBLIC_*` variable is missing or the image host differs ([WEB.md](WEB.md#build-modes)). Fix, then publish again | Adam | 20 min |
| Publish seems stuck | The publish page waits up to 6 minutes, then shows a timeout | Open `<site>/_publish.json` and compare `snapshotGeneratedAt` with the time of the publish. Older means the build is not done or failed (row above) ([WEB.md](WEB.md#publish-to-deploy)). A new publish is allowed once per 60 s | Photographer, then Adam | 10 min |
| Admin sign-in lost (there is no admin password, only the Google account) | She cannot sign in: her Google account is lost, locked or changed, or the app shows the denial text | The other admin (Adam) signs in and adds the new address, or Adam does it without signing in: in the Supabase SQL editor run `insert into public.admin_emails (email) values ('<lowercase address 1>');` with the address exactly as Authentication, Users shows it, in lower case. To remove a lost address: `delete from public.admin_emails where email = '<lowercase address 1>';` Never leave the list empty. More cases below ([ADMIN.md](ADMIN.md#deploying-the-admin-human-steps) step 5; 2-step verification: [row 5](VERIFY.md)) | Adam | 5 min |
| Dependency or runtime update | None scheduled. Node, Astro and Wrangler are pinned ([row 16](VERIFY.md)) | Update only on a security advisory that affects what is deployed or a platform deprecation notice. This does not promise zero: expect it a few times over the years. Then `npm test`, `npm run typecheck`, `npm run gates`, check a preview, publish | Adam | 1 to 3 h, rarely |
| Free-tier price or policy change | A vendor mail, or a limit differs from this repo. The numbers in the docs are unread from vendor pages: TO VERIFY ([row 12](VERIFY.md)) | Re-read the pricing pages (R2, Supabase, Workers, Pages) with the quarterly check and record the date. Adjust `app_config` limits if needed; any cost needs Adam's approval | Adam | 10 min a quarter |
| Backup | There are no backups (owner's decision). Photos exist once, in the photo bucket, and on the photographer's own devices ([BACKUP.md](BACKUP.md)) | Nothing to run. A deleted photo or a lost bucket cannot be recovered; the published catalog can be rebuilt by hand from `catalog/published.json`, drafts and hidden albums cannot | Adam | none |
| Search Console or analytics glance | Optional, only if useful. Cookieless claim not yet checked in a browser: TO VERIFY ([row 10](VERIFY.md)) | Look at the Cloudflare Web Analytics dashboard or Search Console now and then ([WEB.md](WEB.md#analytics)); no alerting | Adam | 5 min |

## Lost sign-in access: Google and the OAuth client

The public site never depends on admin sign-in; only editing waits. Adam owns the Supabase project with his own login and 2-step verification, so he can always act. Menu names are from memory.

| Situation | What works meanwhile | Recovery |
|---|---|---|
| One admin loses her Google account | The other admin signs in | The other admin adds her new address by SQL (row above) |
| Both lose their Google accounts | Nobody can sign in; the public site is fine; the catalog stays reachable in the Supabase dashboard | Adam, signed in to Supabase, inserts the new addresses by SQL in the SQL editor |
| The Google OAuth client or the Cloud project is deleted or its secret changes | Nobody can sign in; the public site is fine | Adam creates a new OAuth client (about 15 min, [ADMIN.md](ADMIN.md#deploying-the-admin-human-steps) step 5, V-1) and updates the Google provider in Supabase (V-2); the allow-list is untouched |
| Google itself is down | Nobody can sign in until it is back; sessions that are still valid keep working | Wait; nothing to change. Do not enable password sign-in as a workaround |
| The app cannot enforce 2-step verification | Whoever controls a listed Google account is the admin | Ask both owners to keep 2-step verification on ([row 46](VERIFY.md)) |

## Quarterly checklist (about 20 minutes)

Why this one recurring task exists: free-tier terms and silent failures can change without a visible symptom. (There is no photo backup to refresh: [BACKUP.md](BACKUP.md).)

1. Glance at the Supabase and Cloudflare dashboards: project active, Worker cron ran, latest Pages builds green, storage figure.
2. Run `npm audit`; act only on findings that ship to production.
3. Re-read the free-tier limits against [VERIFY.md](VERIFY.md) row 12 and write down the date.
4. Check the domain expiry date.

## Deliberately not monitored

No uptime pinger, no alert mail, no error tracking, no alert for a failed cron or a failed build, no backups at all, no automatic dependency updates. This keeps the site free of things to babysit. The cost: a problem is found when someone notices or at the next quarterly check. Realistic worst cases are a paused Supabase project that locks the admin for weeks (the public site stays up), a failed build that leaves the site stale (she sees the publish timeout), photos that exist only in R2 and on her own devices (a deleted photo or lost bucket cannot be recovered), and a lapsed domain.
