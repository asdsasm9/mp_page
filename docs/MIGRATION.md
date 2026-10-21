# Legacy photo migration (`npm run migrate-legacy`)

Moves the 141 legacy photos (13 albums, 3 categories) from `legacy/fotky_web/galleries/` into the new system through
the same guarded path a new upload takes: quota-checked reserve, presigned PUT to R2, HEAD-verified commit,
`register_photo`. It is idempotent and writes nothing unless you pass explicit flags. Plan: `WP-06-migration.md`;
decisions D-10 and D-11. **The live run is a human step (H-10) and never happens from the `autopilot` branch.**

## Usage

```
npm run migrate-legacy -- [options]
```

Default is a dry-run: no network, no writes except `migration-report/` (a `<timestamp>.json`, a `<timestamp>.md` and
`legacy-image-redirects.txt`, all gitignored). Two dry-runs print byte-identical output.

### Flags

| Flag | Meaning |
|------|---------|
| `--help` | Print the usage text and exit 0. |
| `--live` | Write for real. Needs `--confirm-project` and credentials, otherwise exit 2 before any request. |
| `--confirm-project <ref>` | Must equal the host label of `SUPABASE_URL` (for `abcd.supabase.co` it is `abcd`). A typo exits 2. |
| `--album <id>` | Only this legacy album, for example `lucka_filip`. |
| `--limit-bytes <n>` | Refuse to start a run that would write more than n bytes. |
| `--repair` | Re-upload photos whose objects are missing. Live limitation: see "Live --repair limitation" below. |
| `--alt default` | Store the generated alt text instead of null (the default is null, alt is generated when rendering). |
| `--allow-host` | Accept a Supabase host outside `*.supabase.co` and localhost. https is always required (localhost excepted). |

### Environment variables (names only; values are never written to a file, a report or the log)

These are class 5 of `.env.example`. `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `PUBLIC_IMG_BASE_URL` are listed there once,
under the Worker and web classes; the table below lists all seven the script reads. You export them in your shell, they are not read from a file.

| Name | Use |
|------|-----|
| `SUPABASE_URL` | Public project URL. |
| `SUPABASE_ANON_KEY` | Public anon key. |
| `API_BASE_URL` | Origin of the deployed Worker. |
| `PUBLIC_IMG_BASE_URL` | Public image origin (used for the redirect targets). |
| `MIGRATE_ADMIN_EMAIL` | Sign-in of the admin account that runs the migration. |
| `MIGRATE_ADMIN_PASSWORD` | Its password (password grant; the JWT stays in memory only). |
| `MIGRATE_ACCESS_TOKEN` | Optional. An access token of that admin, used instead of the password grant. |

The script never sees R2 keys: only presigned URLs from the Worker. It has no service-role key. A non-admin account
fails closed (`NOT_ADMIN`) before any write. Use your own second admin account, never the photographer's password.

## Prerequisites (all must be true before `--live`)

1. H-2 is finished (accounts and projects exist).
2. Supabase is set up: migrations applied, sign-ups off, your admin user has an `admins` row (`docs/ADMIN.md`, deploy step 5).
3. The Worker is deployed with its R2 bindings and secrets (`docs/DEPLOY-API.md`) and `API_BASE_URL` points to it.
4. The VERIFY rows 33 to 36 in `docs/VERIFY.md` are understood; row 4 (presigned PUT and content-length) has been tested.
5. At least one real photo was uploaded through the admin and displayed correctly. That proves the whole real chain once before 141 photos depend on it. Delete that test photo afterwards if you want a clean catalog.
6. The legacy images exist in `legacy/fotky_web/galleries/` in this checkout.
7. `.env` (not committed) holds the names above.

## Steps

1. **Dry-run first.** `npm run migrate-legacy`. Expect 3 categories, 13 albums, 141 photos, a per-album table and
   `legacy-image-redirects.txt` (a preview) with 141 lines. Real numbers from the dry-run on the real files: 141 photos, about
   154 MB planned in total (real encoded sizes), 36 s on the development machine. Re-run to check it is stable.
2. **First live run on one small album.**
   `npm run migrate-legacy -- --live --confirm-project <ref> --album lucka_filip`
   Pre-flight signs in, reads `GET /storage` and the existing rows, computes the need and aborts with zero writes if
   `used + need` would exceed the hard limit. Check the album in the admin (see the checklist), then continue.
3. **Full run.** `npm run migrate-legacy -- --live --confirm-project <ref>`. Albums already done are skipped.
   Roughly 154 MB goes to R2 and 141 photo rows plus 141 `url_history` redirect rows to the database, 0 EUR. The run stops at the first `STORAGE_FULL` or
   `FILE_TOO_LARGE`. It ends with `RESULT: OK` (exit 0) or `RESULT: INCOMPLETE` (exit 1; read the report, fix, re-run;
   crash-resume and skipping of finished photos are automatic). Each live run writes `migration-report/<timestamp>.json`
   and `.md`, with a `drift` list (existing catalog rows that differ from the mapping; left unchanged). If the upload or
   cover phase fails unexpectedly, the files are still written with `RESULT: INCOMPLETE` and a scrubbed error label (no
   URLs, e-mail addresses or credentials).
4. **Second run for evidence.** Run step 3 again: inserted 0, skipped 141, no duplicates.

## Verification checklist (after the full run)

- [ ] Final line is `RESULT: OK`; the console shows `drift 0` in the catalog and covers lines; the report shows found 141, inserted 141 (first run), failed 0 and orders wrong 0 (order column) for every album.
- [ ] Second run: inserted 0, skipped 141.
- [ ] Admin: 3 categories, 13 albums, photo counts as in `docs/CONTENT-MAPPING.md` section 4; album `sedlakovi` has 42 photos.
- [ ] Photos in each album are in file-number order; covers match `mainImgNum` (sedlakovi 42, anez 9, hradsti 2, pati 5).
- [ ] Storage figure in the admin is plausible and below the warn level; write the real figures into VERIFY row 34.
- [ ] Open a few 720 and 1600 variants and one master from the public image URL; they load and show no GPS data (VERIFY row 35).
- [ ] Albums are `published`, but nothing is public until you press "Zveřejnit web" in the admin. Publish only when ready.
- [ ] The `url_history: legacy image redirects` line shows wanted 141, inserted 141 (first run), changed 0; a second run shows inserted 0, already present 141 (see "The redirect file"). Do not delete `legacy/fotky_web` yet.

## Rollback

There is no bulk undo. To remove migrated photos delete them in the admin (an album or single photos) or call
`POST /photos/delete` with their ids; the Worker removes the R2 objects. Then run reconcile (`docs/DEPLOY-API.md`) to
confirm that rows, objects and the stored byte total agree again (`docs/API.md`). Ids are deterministic, so a later re-run recreates
exactly the same photos. Albums and categories created by the script can be deleted in the admin once empty.

## Live --repair limitation (D-11)

A photo whose row exists but whose files are missing cannot be repaired by the live script: the Worker's reserve
route refuses an existing photo id (`CONFLICT`). The `--repair` flag works against the fake backend only.
Recovery: delete that photo in the admin (or via `/photos/delete`) and run the migration again; it adds the photo again
with the same id. Check its sort position and, if it was the cover, the album cover by hand. A crash between PUT and
commit (no row yet) needs no repair: just re-run.

## What the script does to the images

Sharp re-encodes everything: orientation applied, sRGB, no metadata (EXIF/GPS/ICC dropped). The master is the original
fitted within 3000 px (never upscaled), always re-encoded as JPEG q85, so the stored master is a second lossy
generation of the legacy file (accepted). Tiers come from the shared `variantPlan` (WebP q80 including 720 when the
master is at least 720 px wide, JPEG 1600 q85, OG crop). Each output is checked for EXIF before upload.
`dominant_color` is `#rrggbb` lowercase. Ids are UUIDv5 of the legacy key with a dedicated migration namespace, so
they are stable between runs and machines. `sort` is stored as 10, 20, 30 in file-number order.

## Defaults taken (D-10) and who owns each

Unless the owner objects, these are used. The owner is who can change the default.

| # | Default | Owner |
|---|---------|-------|
| 1 | The live run is a human step: `--live --confirm-project <ref>`, first `--album lucka_filip`, then complete; about 154 MB (planned) to R2, 141 rows, 0 EUR, with a second admin account | Adam (H-10) |
| 2 | Photo alt is stored as null; the text is generated at render time (`--alt default` stores it) | Adam |
| 3 | Masters are re-encoded at q85, which also strips EXIF and GPS | Adam |
| 4 | `sort` is stored as 10, 20, 30 (gaps for later reordering) | Adam |
| 5 | Album slugs keep their underscores (`pavla_rafael`, `helis_tom`, `lucka_filip`) unless hyphens are asked for before the live run | Adam |
| 6 | The live run writes the 141 legacy image redirects to `url_history` (D-13); they reach visitors only after a publish following H-5 | Adam (H-5) |

## The redirect file

The 141 legacy image redirects (D-13, T-200) are written to the database, not handed over as a file. The live run
inserts one `url_history` row per migrated photo: `old_path` `/fotky_web/galleries/<cat>/<id>/<n>.jpg`, `status` 301,
`target` the absolute `<PUBLIC_IMG_BASE_URL>/photos/<photo_id>/1600.jpg` (the default `https://img.mullnyphotos.cz` when
the variable is unset; the console and report print the host used). The insert goes through PostgREST under the admin
JWT: `authenticated` has insert on `url_history` behind the `is_admin()` policy, so no migration was needed.

- **Order in the live run:** pre-flight, catalog (categories, albums), photos, covers and order check, then the
  redirects last, because the targets contain the photo ids. The line is `url_history: legacy image redirects wanted 141,
  inserted 141, already present 0, changed 0`, repeated in the report (`.json` and `.md`).
- **Idempotent:** `old_path` is unique and the insert uses `on conflict do nothing`. A rerun inserts 0 and reports 141
  already present. A row that exists with another target or status is never overwritten; it is listed as `CHANGED`
  and the run ends `RESULT: INCOMPLETE` (exit 1). A changed row means the legacy URL points elsewhere than the
  migrated photo, usually because `PUBLIC_IMG_BASE_URL` changed between runs. Fix the row by hand in the database, or
  delete it and re-run. If the redirects phase itself fails, the report of the finished upload phase is still written
  with the redirects block marked `FAILED`, the run ends `INCOMPLETE`, and a re-run adds the rows.
- **`--album <id>`** inserts only the redirects of that album's photos. Photos that are still missing get their row
  when a later run registers them.
- **Dry-run** writes nothing to the database. It prints `redirect lines 141` and still writes
  `migration-report/legacy-image-redirects.txt` (gitignored) as a human-readable preview of the same rows; nothing
  consumes that file any more. `apps/web` reads the rows from the published snapshot (`snapshot.redirects`) and emits them
  into `_redirects`; a build fails if a target is not on the image origin.
- **Switch-on:** the rows are in the database after the live run, but a visitor only gets them after the next publish
  and web build. Do that only after H-5 (DNS on Cloudflare and `img.mullnyphotos.cz` connected), because the targets are on
  the public image host.
- **Rollback:** deleting photos (admin or `POST /photos/delete`) does not remove their `url_history` rows, which would
  then point at objects that are gone. After a rollback run
  `delete from public.url_history where old_path like '/fotky_web/galleries/%';` in the Supabase SQL editor (or delete those rows in
  the table editor) before publishing, and re-run the migration to recreate them. A re-run recreates photos with the
  same ids, so the old rows stay valid in that case.

## Evidence still to collect

VERIFY rows 33 to 36 (first real presigned PUT through the script, real quota figures, sharp output on live R2,
live sign-in with the password grant). The admin is password-only (D-12). If TOTP is added later and the password
grant is blocked because the account has it, sign in on the admin, copy the access token and pass it as `MIGRATE_ACCESS_TOKEN`; it expires after about an hour.
