# Data model

Source of truth: `supabase/migrations/*.sql` (applied in filename order). Types and contracts live in
`packages/shared/src` (`db.ts` has `DB_COLUMNS`, a drift test compares it with the catalog). The privilege
tables below are checked against `supabase/tests/golden/privilege-matrix.json` by
`supabase/tests/data-model-doc.test.ts`; change the migration, the golden file and this page together.

## Deviations from MASTERPLAN (read first)

1. **D-5: no direct insert or delete on `photos`.** MASTERPLAN gives authenticated users full writes on
   `photos`. That would bypass the storage quota. Authenticated gets `select` plus a column-limited
   `update (album_id, sort, alt, caption)`; rows are created and removed only through `register_photo()`
   and `delete_photos()`. `register_photo()` takes an optional `p_legacy_key`, so the WP-6 migration runs as
   the signed-in admin with no service key.
2. **Reservation TTL.** MASTERPLAN says 15 minutes in one place and 60 in another. Both are right for
   different things: the presigned upload URL lives **15 minutes** (set by the Worker, WP-4); the quota
   reservation lives **60 minutes** (`app_config.reservation_ttl_min`), so a slow batch keeps its reserved
   bytes after the URL has expired and can be re-presigned without losing its place. Expired reservations
   stop counting immediately and are deleted on the next `reserve_uploads()` call.
3. **Plain CSS with design tokens, not Tailwind** (D-6). MASTERPLAN section 3 once named Tailwind for `apps/web`; no effect on the database.

## Tables

All tables are in `public` with row level security on. Every migration starts each table with
`revoke all ... from anon, authenticated` and then grants explicitly.

| Table | Purpose and key constraints |
|---|---|
| `admin_emails` | `email` (pk, lowercase, trimmed). The Google sign-in allow-list: `is_admin()` is true only for a confirmed user with a verified Google identity whose e-mail is listed and equals the user's e-mail (migration `20261022100000_admin_google_signin.sql`, which also dropped the old `admins` table). RLS on, no grant to any API role; only the definer reads it. No address is created by migrations or seed. |
| `categories` | `slug` unique, `^[a-z0-9]+(-[a-z0-9]+)*$`, 2..60, not in the reserved list; `name`, SEO fields, `sort`, `visible`. |
| `albums` | `category_id` (restrict), `slug` unique (`^[a-z0-9]+([-_][a-z0-9]+)*$`, 2..60), `title`, `place`, `shot_on`, `cover_photo_id` (set null), `published`, `legacy_id` unique. |
| `photos` | `album_id` (restrict), `master_key` unique and equal to `photos/<id>/master.jpg`, `width`, `height`, `variants` jsonb, `bytes_total`, `dominant_color` (null or `^#[0-9a-f]{6}$`), `alt` (at most 300 chars), `caption`, `sort`, `legacy_key` unique (null or 1..200 chars of `A-Za-z0-9_./-`, constraint `photos_legacy_key_format` from migration `20261019100900_photo_input_checks.sql`). A direct `register_photo` call that violates a check fails with SQLSTATE 23514, which the Worker maps to the generic `UPSTREAM_ERROR`. |
| `url_history` | `old_path` unique, `target`, `status` in (301, 410). Filled by the slug-history triggers and by hand. |
| `app_config` | Single row: quota hard 9.5e9, warn 8e9, max upload 41943040, max batch 200, reservation TTL 60 min. |
| `site_state` | Single row: `pending_changes`, `last_published_at`, `last_publish_requested_at`. |
| `publish_log` | One row per publish request (newest 100 kept). |
| `upload_reservations` | `photo_id` (pk), `bytes`, `expires_at`. Reserved bytes count only while unexpired. |
| `keepalive` | Single row touched by `keepalive()`; no API role can read it. |
| `change_log` | The unpublished changes (migration `20261022160000_change_log.sql`, T-251, D-18 option A): one row per catalog row (`table_name` categories/albums/photos, `row_id`, unique together) that differs from the last published site. `kind` is added, edited, deleted or reordered; `label` is the name at change time (category name, album title, photo alt else caption else empty); `category_id/category_name/album_id/album_title` are the grouping context at change time (no foreign keys). Admins can select; nobody can write through the API. Written by the `log_change` trigger, cleared by `record_publish`. See "Change log" below. |

Reserved category slugs: portfolio, o-mne, kontakt, 404, admin, api, img, assets, _astro, fotky_web,
sitemap, robots, cookies, ochrana-udaju (the same list as `RESERVED_CATEGORY_SLUGS`).

Used storage is `sum(photos.bytes_total)`; reserved is the sum of unexpired reservations. There is no stored counter.

The `variants` jsonb shape is `{master:{w,h,bytes}, webp:[{tier,w,h,bytes}], jpeg:{w,h,bytes}, og:{w,h,bytes}}`;
key paths are never stored, they derive from the photo id.

WebP tiers: `tier` is one of 480, 720, 960, 1600, 2400 (defined once as `WEBP_TIER_VALUES` in `packages/shared`);
only tiers not wider than the master exist (a 719 px master has no 720). New uploads must carry exactly the planned
set, including 720 when the master is at least 720 px wide; a commit with a missing or extra tier (for example 800) is
refused. Rows stored without a 720 entry are still valid: they are never re-validated, reconcile reports no drift for
them and the site renders their srcset without 720 (it falls back to 960). The 720 tier needed no SQL migration
(`variants_bytes_sum` and `register_photo` read the `webp` array generically) and no stored file had to be
regenerated: the seed and the snapshot fixture are regenerated from `scripts/gen-fixtures.ts`.
`dominant_color` (`#rrggbb`) is the placeholder block shown before an image loads.

## Grant matrix

Generated from the catalog (`has_table_privilege`, `has_column_privilege`). `table` means the whole table,
`none` no privilege, `columns:...` a column-limited privilege. Policies on every granted command require
`is_admin()` (`admin_emails`: no API access). anon holds nothing anywhere.

### Table privileges

| table | role | select | insert | update | delete |
|---|---|---|---|---|---|
| admin_emails | anon | none | none | none | none |
| admin_emails | authenticated | none | none | none | none |
| albums | anon | none | none | none | none |
| albums | authenticated | table | table | table | table |
| app_config | anon | none | none | none | none |
| app_config | authenticated | table | none | none | none |
| categories | anon | none | none | none | none |
| categories | authenticated | table | table | table | table |
| change_log | anon | none | none | none | none |
| change_log | authenticated | table | none | none | none |
| keepalive | anon | none | none | none | none |
| keepalive | authenticated | none | none | none | none |
| photos | anon | none | none | none | none |
| photos | authenticated | table | none | columns:album_id,alt,caption,sort | none |
| publish_log | anon | none | none | none | none |
| publish_log | authenticated | table | none | none | none |
| site_state | anon | none | none | none | none |
| site_state | authenticated | table | none | none | none |
| upload_reservations | anon | none | none | none | none |
| upload_reservations | authenticated | table | none | none | none |
| url_history | anon | none | none | none | none |
| url_history | authenticated | table | table | table | table |

### Function execute privileges

All functions are `security definer` (except the immutable helper `variants_bytes_sum`) with
`search_path = ''`, fully schema-qualified, and no PUBLIC execute.

| function | anon | authenticated |
|---|---|---|
| albums_delete_history | no | no |
| albums_slug_history | no | no |
| bump_pending | no | no |
| categories_slug_history | no | no |
| check_album_cover | no | no |
| clear_cover_on_photo_change | no | no |
| delete_photos | no | yes |
| is_admin | no | yes |
| keepalive | yes | yes |
| log_change | no | no |
| record_publish | no | yes |
| record_slug_redirect | no | no |
| register_photo | no | yes |
| request_publish | no | yes |
| reserve_uploads | no | yes |
| set_updated_at | no | no |
| storage_usage | no | yes |
| variants_bytes_sum | no | no |

## RPCs and error codes

Functions raise an exception whose message equals the code. `NOT_ADMIN` uses SQLSTATE `42501`.

| RPC | Returns | Error codes |
|---|---|---|
| `is_admin()` | boolean | none |
| `storage_usage()` | `{used_bytes, reserved_bytes, hard, warn, photo_count, level}` | NOT_ADMIN |
| `reserve_uploads(p_items)` | `{results:[{photo_id, ok, code?}], used_bytes, reserved_bytes, hard, warn, level}`; per-item codes FILE_TOO_LARGE and STORAGE_FULL, first-fit, refused items consume nothing | NOT_ADMIN, BATCH_TOO_LARGE, INVALID_ITEMS |
| `register_photo(p_id, p_album_id, p_width, p_height, p_variants, p_bytes_total, p_dominant_color, p_alt, p_legacy_key)` | the photo row plus `already_existed`; idempotent on id and on `legacy_key`; derives `master_key` itself | NOT_ADMIN, BYTES_MISMATCH, CONFLICT, ALBUM_NOT_FOUND, STORAGE_FULL |
| `delete_photos(p_ids)` | `{deleted:[{id, master_key}]}`; the Worker then removes the R2 objects | NOT_ADMIN |
| `request_publish()` | `{log_id, pending_seen}`; one request per 60 s | NOT_ADMIN, PUBLISH_TOO_SOON |
| `record_publish(p_log_id, p_status, p_pending_seen, p_albums, p_photos, p_bytes, p_error)` | `{ok, pending_changes}`; on `ok` subtracts only what was seen | NOT_ADMIN, CONFLICT, INVALID_STATUS |
| `keepalive()` | `{ok:true}`; writes at most once per 60 s | none |

Shared code list (`ApiErrorCode`): NOT_ADMIN, STORAGE_FULL, FILE_TOO_LARGE, BATCH_TOO_LARGE, PUBLISH_TOO_SOON,
BYTES_MISMATCH, ALBUM_NOT_FOUND, KEY_MISMATCH, CONFLICT. KEY_MISMATCH is reserved for the Worker (the database
derives the key and cannot mismatch). INVALID_ITEMS and INVALID_STATUS are input errors, and
COVER_NOT_IN_ALBUM (SQLSTATE 23514) comes from the cover trigger.

## Triggers

- `set_updated_at` before update on categories, albums, photos.
- `bump_pending` after insert, update or delete, per row, on categories, albums, photos, url_history.
- `log_change` after insert, update or delete, per row, on categories, albums, photos (see "Change log").
- `check_album_cover`: a cover photo must belong to its album.
- `clear_cover_on_photo_change`: moving or deleting a photo clears covers that point at it.
- Slug history (migration `20261019100700_slug_history.sql`): renaming an album slug or moving it to another
  category writes a 301 `/<cat>/<old>/` to the new path (earlier redirects are repointed, no chains); changing a
  category slug writes 301 rows for the category and each of its albums; deleting an album writes a 410 row.

## Change log

`change_log` answers "what is unpublished?" and is what the admin shows (the publish screen counts its rows and
"Zobrazit zmeny" lists them). `site_state.pending_changes` and `bump_pending` are unchanged and remain the publish
bookkeeping (`pending_seen`), but the UI no longer shows that raw counter.

- Insert: `added`. Delete: `deleted`, except that a row which was only added since the last publish is removed
  from the log (net change zero). Update touching only `sort`: `reordered`. Any other update: `edited`.
  An update that changes nothing but `updated_at` is not logged.
- At most one line per row: later changes refresh time, label and context of the existing line. `added` stays
  `added`; `reordered` becomes `edited` when something else changes too; a re-created row after `deleted` is `edited`.
- `url_history` is deliberately not logged: its rows come from the slug and delete triggers of albums and
  categories, which already produce an `edited` or `deleted` line.
- A cover photo cleared by `clear_cover_on_photo_change` shows as an `edited` album (the cover really changed).
- Clearing: `record_publish(..., 'ok', ...)` deletes every line with `at <=` the request time of that publish
  (`publish_log.requested_at`). Lines written while the build runs stay listed, like the counter keeps them. A failed
  publish clears nothing. (A filter on `last_published_at` was rejected: it would hide edits made during the build.)
- Lines exist only from the moment the migration is applied. Publish once before applying it (or accept that older
  unpublished edits are not listed). The seed clears the log the same way it resets the counter.

## Seed and fixtures

`npm run fixtures` (`scripts/gen-fixtures.ts`) writes `packages/shared/fixtures/legacy-photos.json`,
`supabase/seed.sql` and `packages/shared/fixtures/snapshot.fixture.json` from the same rows, with deterministic
UUIDv5-style ids. A drift test regenerates them in memory and compares. The seed runs as the database owner,
creates no admin and leaves `pending_changes` at 0.

## Legacy migration notes (WP-6)

`npm run migrate-legacy` (see `docs/MIGRATION.md`) creates the legacy rows only through the Worker and
`register_photo`, never by direct insert. Its photo ids are UUIDv5 of the `legacy_key` in a migration namespace
different from the fixture namespace, so they are deterministic across runs. `photos.sort` is stored as 10, 20, 30
(`register_photo` assigns max+10 in call order, and the script commits in file-number order). Masters are re-encoded
JPEG q85 within 3000 px with metadata stripped, not the legacy bytes. `alt` is null by default (default text at render
time).

## Snapshot `updatedAt` (WP3-3)

Each snapshot album and category carries `updatedAt` (ISO date-time, UTC). `buildSnapshot` sets an album's value to
the latest `updated_at` of the album row and its photos, and a category's to the latest of the category row and its
published albums (hidden or draft rows do not count). The public site uses it as sitemap `lastmod`. The fixture uses
the fixed fixture clock; the seed test compares the database-built snapshot with the fixture ignoring `updatedAt`,
because the seed takes the database clock.
