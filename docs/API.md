# API Worker contract (apps/api)

The Worker is the only code that touches R2 credentials. The browser talks to Supabase for CRUD, to this Worker for
uploads, deletes, reconcile and publish, and to R2 directly only through presigned PUT URLs this Worker issues.
Schemas live in `packages/shared/src/api.ts` (request and response zod schemas, error codes, statuses). Deploy steps for
the human are in `docs/DEPLOY-API.md`. Open verification items are in `docs/VERIFY.md`.

A test (`apps/api/test/docs.test.ts`) fails when an endpoint in the route table has no `## METHOD /path` heading below.

## Conventions

- Auth: `Authorization: Bearer <Supabase access token>` of an admin user. The Worker verifies it against Supabase with the
  anon key; every database call runs under the caller's token (no service-role key exists anywhere). Only `GET /health` is public.
- Bodies: JSON, `content-type: application/json`, at most 256 KB (declared length and streamed length are both checked).
- Errors: `{ "error": "<CODE>" }`, plus `"retryAfter"` (seconds) for `PUBLISH_TOO_SOON`. Bodies never carry input, stack
  traces, SQL, URLs or secrets.
- Every response carries `cache-control: no-store`, `x-content-type-options: nosniff`, `vary: Origin` and `x-request-id`.
- CORS: exact-match allowlist from `ALLOWED_ORIGINS`; no wildcard, no credentials. A disallowed `Origin` gets 403
  `INVALID_REQUEST` before routing; a preflight from an allowed origin gets 204 before auth. Requests without `Origin`
  (curl, cron) go on to auth.
- Wrong method on a known path: 405 `METHOD_NOT_ALLOWED` with `Allow`. Unknown path: 404 `NOT_FOUND`.
- Missing or malformed configuration or R2 binding: 500 `CONFIG_ERROR`; the log names the variables, never values.
- Unexpected exception: 500 `INTERNAL` and nothing else; the log keeps the request id and the error class name only.

### Error codes and statuses

| Code | Status | Raised by |
|------|--------|-----------|
| UNAUTHENTICATED | 401 | missing, malformed or expired token |
| NOT_ADMIN | 403 | valid user who is not in `admins` |
| INVALID_REQUEST | 400 (403 for a disallowed Origin) | body, type, schema |
| INVALID_ID | 400 | an id is not a UUID |
| INVALID_ITEMS | 400 | reserve items do not match the planned file set |
| NOT_FOUND | 404 | unknown path |
| ALBUM_NOT_FOUND | 404 | reserve or register with an unknown album |
| METHOD_NOT_ALLOWED | 405 | wrong method |
| PAYLOAD_TOO_LARGE | 413 | body over 256 KB |
| BATCH_TOO_LARGE | 413 | more items than `app_config.max_files_per_batch`, or more than 200 ids in a delete |
| FILE_TOO_LARGE | 413 | a file over `app_config.max_upload_bytes` |
| STORAGE_FULL | 409 | quota hard limit would be crossed |
| CONFLICT | 409 | a photo id already exists |
| SNAPSHOT_EMPTY | 409 | publish with zero published albums |
| KEY_MISMATCH | 422 | commit: objects missing, wrong size, or over the reservation |
| BYTES_MISMATCH | 422 | commit: `bytes_total` differs from the sum of the variants |
| PUBLISH_TOO_SOON | 429 | second publish within 60 s |
| UPSTREAM_ERROR | 502 (503 when the auth check cannot reach Supabase and fails closed) | Supabase or R2 failure |
| PUBLISH_FAILED | 502 | the Pages deploy hook did not answer 2xx |
| CONFIG_ERROR | 500 | invalid configuration or missing binding |
| INTERNAL | 500 | unexpected exception |

### Limits

| Limit | Value | Where it lives |
|-------|-------|----------------|
| Quota hard / warn | 9,500,000,000 / 8,000,000,000 bytes (decimal) | `app_config` (database), changeable without a deploy |
| Per file | 41,943,040 bytes (40 MiB) | `app_config.max_upload_bytes` |
| Files (photos) per reserve batch | 200 | `app_config.max_files_per_batch` |
| Reservation lifetime | 60 minutes | `app_config.reservation_ttl_min` |
| Presigned URL lifetime | 15 minutes | Worker constant |
| JSON body | 256 KB | Worker constant |
| Delete batch | 200 ids | shared schema |
| Publish rate | 1 per 60 s | database `request_publish` |
| Photo master edge | at most 3000 px | shared schema |

## GET /health

No auth. Returns 200 `{ "ok": true }`. Any other method: 405.

## GET /storage

Quota status: `{ used_bytes, reserved_bytes, hard, warn, photo_count, level }` with `level` one of `ok`, `warn`, `full`.

## POST /uploads/reserve

Request: `{ album_id, items: [{ photo_id, width, height, files: [{ kind, tier?, bytes }] }] }`. `files` must be exactly
the planned set for that size (master, the WebP tiers that fit, the 1600 JPEG, the OG image); the client picks no keys
and no content types. A missing or extra tier (for example 800, or 2400 for a 1200 px master) is a 400. The Worker checks the per-file limit, then asks the database `reserve_uploads` (hard limit,
first-fit across the batch); only accepted items get presigned PUT URLs. The signed headers include `content-type`,
`content-length` and `cache-control` (`public, max-age=31536000, immutable`).

Example for a 1200 x 800 photo (the WebP tiers that fit are 480, 720 and 960; the planned set has six files):

```json
{
  "album_id": "bbbbbbbb-0000-4000-8000-000000000001",
  "items": [{
    "photo_id": "cccccccc-0000-4000-8000-000000000001", "width": 1200, "height": 800,
    "files": [
      { "kind": "master", "bytes": 310000 },
      { "kind": "webp", "tier": 480, "bytes": 38000 },
      { "kind": "webp", "tier": 720, "bytes": 71000 },
      { "kind": "webp", "tier": 960, "bytes": 118000 },
      { "kind": "jpeg", "bytes": 160000 },
      { "kind": "og", "bytes": 90000 }
    ]
  }]
}
```

A 3000 x 2000 photo lists all five tiers (480, 720, 960, 1600, 2400); a 600 px master lists 480 only.

Response `{ items: [{ photo_id, ok, code?, uploads? }], used_bytes, reserved_bytes, hard, warn, level }`. An item is
`ok: true` with `uploads: [{ kind, tier?, key, method: "PUT", url, headers, expiresAt }]`, or `ok: false` with
`code` `FILE_TOO_LARGE` or `STORAGE_FULL`. Status 200 when at least one item was accepted; 409 `STORAGE_FULL`
(same body shape) when none was. Other errors: 400, 404 `ALBUM_NOT_FOUND`, 409 `CONFLICT`, 413 `BATCH_TOO_LARGE`.

## POST /uploads/commit

Request: `{ photo_id, album_id, width, height, variants, bytes_total, dominant_color?, alt?, legacy_key? }`.
`variants` is `{ "master": {w,h,bytes}, "webp": [{ "tier": 480, ... }, { "tier": 720, "w": 720, "h": 480, "bytes": 71000 }, { "tier": 960, ... }], "jpeg": {...}, "og": {...} }`
and must equal the planned set for the size (a new upload without the 720 entry is a 400); rows already stored without
720 stay valid. `dominant_color` is `#rrggbb`.
`legacy_key` is for the WP-6 migration only (pattern `weddings|portraits|couples/<name>/<n>.jpg`).
Before the database is touched the Worker sends a HEAD for every object and checks that it exists, has the declared
size, is within the per-file limit, and that the total fits the reservation. Then it calls `register_photo`, which
re-checks the quota. A refused commit removes the objects unless a row already owns them.

Response `{ photo, already_existed }` (200; a repeated commit is idempotent). Errors: 422 `KEY_MISMATCH`,
422 `BYTES_MISMATCH`, 409 `STORAGE_FULL`, 404 `ALBUM_NOT_FOUND`, 400.

## POST /photos/delete

Request `{ ids: [uuid, ...] }` (1 to 200). The rows are deleted first (`delete_photos`; the stored total drops and album
covers clear), then every object under `photos/<id>/` is deleted immediately, including leftovers.
Response `{ deleted, objectsDeleted, failed: [ids], publishRecommended: true }`. An id in `failed` has no row any more;
reconcile removes its leftover objects later. The live site keeps showing the removed photo until the next publish
(decision D-6: immediate deletion for privacy takedowns and an honest quota).

## POST /storage/reconcile

Request `{ apply?: boolean, cursor?: string }` (empty body allowed). Compares photo rows with the objects under
`photos/`. Response `{ r2: {objects, bytes}, db: {photos, bytes}, orphans, missing, sizeMismatch, unknownKeys, applied,
deleted, cursor? }`.

- Orphans are objects of a photo id with no row, not reserved, and all older than 2 hours (younger ones may belong to
  an upload that is not committed yet). With `apply: true` only orphans are deleted. Rows and keys outside `photos/`
  are never touched.
- `missing` (a row whose objects are gone) and `sizeMismatch` are reports only.
- There is no stored-correction value: the database total is the sum of the photo rows, so it cannot drift. The
  "Použít skutečnou hodnotu" confirmation and the "Opraveno: databáze ukazovala ..." result text in `docs/ADMIN-UX.md`
  section 3.7 are therefore dropped. The "Zkontrolovat úložiště" button shows the report (orphans, missing objects,
  size mismatches); cleaning orphans is a separate confirmed action that sends `apply: true`. WP-5 must follow this
  instead of 3.7 (the wording of the new texts is WP-5's).
- One call lists at most 20 pages of 1000 objects. When more remain the response has an opaque `cursor`; the client
  repeats the call with it until there is none, and the sum of the calls equals one full run.

## POST /publish

No body. In order: `request_publish` (admin check, one per 60 s, creates the publish-log row); read all catalog tables
under the caller's token; build and validate the snapshot; refuse it when no album is published; write
`catalog/published.json` to the public bucket (the only thing publish stores; there are no backups) with
`Cache-Control: no-cache`; POST the Pages deploy hook; `record_publish ok` (reduces `pending_changes` by exactly what was
seen when the request started).

Response 200 `{ log_id, snapshot_generated_at, counts, snapshot_bytes, pending_seen }`. Errors: 429 `PUBLISH_TOO_SOON`
(with `retryAfter` and a `Retry-After` header; nothing written), 409 `SNAPSHOT_EMPTY` (nothing written, no hook call),
502 `PUBLISH_FAILED` (hook not 2xx; the log row is `failed`, `pending_changes` unchanged, the body never contains the
hook URL), 502 `UPSTREAM_ERROR`.

"ok" means "build triggered", not "site updated". The Pages build result is not known to the Worker; the admin polls
`/_publish.json` on the public site and shows a timeout if the new snapshot time does not appear. A snapshot of 4000
photos is about 2 MB (`docs/VERIFY.md` row 13).

## Scheduled handler (cron)

Not an HTTP route. `wrangler.toml` has `crons = ["17 3 * * *"]` (daily, 03:17 UTC). The `scheduled` export calls the
anon-callable database function `keepalive()` through PostgREST with the anon key and no user token, so the Supabase
free project is not paused for inactivity. A failure is logged (`KEEPALIVE_FAILED`, no detail) and never thrown; a
silent failure is visible only in the Cloudflare dashboard or when Supabase pauses (accepted gap). Whether cron
triggers and the keepalive count as activity work on the free plans is `docs/VERIFY.md` rows 3 and 11.

## Decisions and accepted limitations

- **Draft photos are not private.** The public bucket serves every object under `photos/<id>/`, including photos of
  unpublished albums, to anyone who knows the URL. The id is an unguessable UUID and the snapshot never lists drafts,
  so drafts are unlisted, not private. A real private-draft requirement would need signed read URLs and a different
  publish flow. (Decision WP-4 D-6 point 6.)
- **Direct `register_photo` call (accepted limitation).** An admin can call the database function directly with their own token and skip the
  Worker's HEAD verification. The quota still holds (the function re-checks it) and reconcile reports size mismatches
  and missing objects. Closing the gap would need a service-role key, which is rejected. (Decision D-7.)
- **Presigned content-length** may not be enforced by R2. The HEAD check at commit, the database backstop and reconcile
  stay mandatory either way (`docs/VERIFY.md` row 4).
- **Publish and CPU.** Whether the free Workers CPU limit is enough for publishing is unmeasured on the real runtime
  (`docs/VERIFY.md` row 13). If it is not, the first step is to skip full snapshot validation in the Worker (the Astro
  build validates again), before any paid plan is considered.

## What other work packages call

- WP-5 (admin): `GET /storage`, `POST /uploads/reserve`, PUT to the presigned URLs, `POST /uploads/commit`,
  `POST /photos/delete`, `POST /storage/reconcile`, `POST /publish`; polls `/_publish.json`. The reconcile screen has no
  "use the real value" button (see above).
- WP-6 (legacy migration): `POST /uploads/reserve` and `POST /uploads/commit` with `legacy_key`, so migrated photos go
  through the same guarded path as new ones.
- WP-3 (public site): reads `catalog/published.json` at build time and publishes `/_publish.json`; it never calls the Worker.
