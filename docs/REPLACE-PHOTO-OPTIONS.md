# Replace a photo atomically: option B change list

Status: needs Adam's approval. Nothing in this document is built. No file under `apps/api` or `supabase` has been touched (T-269, WP-10 step 9, plan section 5 option B). Today the admin ships option A (T-262, client swap: add the new photo, copy sort/alt/caption, set the cover, delete the old one).

## 1. Why B exists

Option A is not atomic. If the browser closes between "add" and "delete", both photos exist and the admin shows the recovery state "Nahrazení nedokončeno" (Dokončit / Zrušit). It also needs quota for both photos at once, and it drops anything stored by `legacy_key`. Option B makes copy, cover, legacy key and delete one database transaction. The new photo still gets a new id and new R2 keys: files are `public, max-age=31536000, immutable` under id-derived keys, so overwriting under the same id is rejected (option C).

What B gains over A: one all-or-nothing step; `created_at`/sort/alt/caption/cover/legacy_key moved in the same transaction; one change_log entry per replace; the old R2 files are removed by the Worker right after the commit.
What B costs: one migration, one Worker route, one shared schema, golden updates, deploy of both, and a decision on the points in section 8.

## 2. Flow (client + Worker + SQL)

1. Admin encodes the better file and uploads it exactly like a new photo: `POST /uploads/reserve` for the new id, presigned PUTs to R2 (the new id is chosen by the client as today; replace never reuses an id).
2. Instead of `POST /uploads/commit`, the admin calls `POST /photos/replace` with `{ old_id, new_id, width, height, variants, bytes_total, dominant_color }`.
3. The Worker verifies the uploaded objects exactly like commit (reuse the same head/size checks), then calls RPC `replace_photo` with the user's JWT (pass-through, no service role).
4. `replace_photo` in one transaction: registers the new row in the old row's album, copies sort/alt/caption, repoints `albums.cover_photo_id`, moves `legacy_key`, deletes the old row, returns `{ photo, replaced: { id, master_key } }`.
5. The Worker removes all R2 objects under `photos/<old_id>/` (same helper as delete: `removePhotoObjects`) and answers `{ photo, objectsDeleted, failed, publishRecommended: true }`.

Failure windows: if step 3 fails nothing changed (new objects are orphans for reconcile, same as an aborted upload). If step 5 fails the id is listed in `failed` and reconcile cleans up later, identical to `/photos/delete`.

## 3. Worker route: `POST /photos/replace`

| File | Change |
|---|---|
| `apps/api/src/routes/replace.ts` (new) | `createReplaceRoute({ storage })`, modelled on `routes/commit.ts` (object verification) and `routes/delete.ts` (post-commit object removal). `methods: ['POST']`. Body via `readJsonBody`, `ReplaceRequestSchema.safeParse`, `apiCodeFromZodError`. Reject `old_id === new_id` with `INVALID_REQUEST` before any RPC. |
| `apps/api/src/default-routes.ts` | register `'/photos/replace': (s) => createReplaceRoute({ storage: s.photos })`. |
| `apps/api/src/index.ts` / router | none expected (routes come from the table). Check `router.test.ts` for a route-count assertion. |
| `apps/api/wrangler.*` | none (no new binding, secret or env). |

New error codes only if needed: reuse `NOT_ADMIN`, `ALBUM_NOT_FOUND`, `STORAGE_FULL`, `BYTES_MISMATCH`, `CONFLICT`; add `PHOTO_NOT_FOUND` for an unknown `old_id` (add to `ApiCode` list in `packages/shared/src/api.ts` and to `docs/API.md` error table).

## 4. Shared schema (`packages/shared/src/api.ts`)

Add next to `DeleteRequestSchema`:

- `ReplaceRequestSchema = z.object({ old_id: uuid, new_id: uuid, width, height, variants: PhotoVariantsSchema, bytes_total, dominant_color: optional }).strict()`; refine `old_id !== new_id`.
- `ReplaceResponseSchema = { photo: PhotoRow-shaped, objectsDeleted: number, failed: uuid[], publishRecommended: true }`.
- Types `ReplaceRequest`, `ReplaceResponse`; export through the package index.
- Tests in `packages/shared/src/api.test.ts`: valid body, `old_id === new_id` rejected, extra key rejected (strict), bad uuid, variants with an unsorted webp list rejected, `bytes_total` type.

## 5. SQL: new migration `supabase/migrations/<timestamp>_replace_photo.sql`

Not a change to existing migrations. Sketch of the function (to be written and reviewed after approval):

```
create function public.replace_photo(
  p_old_id uuid, p_new_id uuid, p_width integer, p_height integer,
  p_variants jsonb, p_bytes_total bigint, p_dominant_color text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
```

Body, in this order:

1. `if not (select public.is_admin()) then raise exception 'NOT_ADMIN' using errcode = '42501'; end if;`
2. `perform 1 from public.site_state for update;` (serialises with publish, register_photo and delete_photos).
3. Refuse `p_old_id = p_new_id` (`CONFLICT`).
4. `select * into v_old from public.photos where id = p_old_id for update;` not found -> `PHOTO_NOT_FOUND`.
5. `p_bytes_total` must equal `public.variants_bytes_sum(p_variants)` else `BYTES_MISMATCH`.
6. New id must not exist (`CONFLICT`); the new photo is always inserted into `v_old.album_id` (a replace never moves albums; different albums are refused by construction, there is no album parameter).
7. Quota backstop: `used - old.bytes_total + others' live reservations + p_bytes_total <= quota_hard_bytes`, else `STORAGE_FULL`. Counting the old bytes as freed is what makes B cheaper than A (A needs both at once).
8. `delete from public.upload_reservations where photo_id = p_new_id`.
9. Move the legacy key: `legacy_key` is unique, so set it to null on the old row first (`update ... set legacy_key = null`), then insert the new row with `v_old.legacy_key`.
10. Insert the new row with `album_id`, `master_key = 'photos/' || p_new_id || '/master.jpg'`, `sort = v_old.sort`, `alt = v_old.alt`, `caption = v_old.caption`, `created_at` default (decision in section 8).
11. `update public.albums set cover_photo_id = p_new_id where cover_photo_id = p_old_id;` Must run before the delete, otherwise `photos_clear_cover` nulls it. The `albums_check_cover` trigger passes because the new row is already in that album.
12. `delete from public.photos where id = p_old_id;`
13. Return `jsonb_build_object('photo', to_jsonb(v_new), 'replaced', jsonb_build_object('id', v_old.id, 'master_key', v_old.master_key))`.

Triggers that fire and need no change: `photos_set_updated_at`, `photos_bump_pending` (pending changes counter), `photos_log_change` (change_log gets an insert and a delete row; decide in section 8 whether to collapse them into one "replaced" entry, which would need a change to the change_log migration and the admin "Změny" screen), `photos_clear_cover` (finds nothing after step 11).

Security:
- `security definer`, `set search_path = ''`, every object schema-qualified.
- `revoke execute on function public.replace_photo(uuid, uuid, integer, integer, jsonb, bigint, text) from public, anon;`
- `grant execute on function public.replace_photo(uuid, uuid, integer, integer, jsonb, bigint, text) to authenticated;` (the `is_admin()` check inside is the real gate, same as register_photo/delete_photos).
- No new table, column or policy; authenticated users still have no insert/delete on `public.photos` (D-5): this function is the only new write path.
- The Worker calls it with the caller's JWT (`supabase.rpc(..., jwt)`), never the service role.

Note on `url_history`: it holds album and category paths (old_path -> target, 301/410), not photo ids, so there is nothing to repoint there for a photo replace. The plan text "repoint url_history" refers to the legacy image redirect; in the schema the link from an old-site image to a photo is `photos.legacy_key`, which step 9 moves. How the public site resolves old image URLs from `legacy_key` must be checked before approval (section 8, question 3).

## 6. Privilege matrix and architecture goldens

| File | Change |
|---|---|
| `supabase/tests/golden/privilege-matrix.json` | add `"replace_photo": { "anon": false, "authenticated": true }` next to `delete_photos` (line 60). |
| `docs/DATA-MODEL.md` | add `replace_photo` to the privilege table (near line 125) and to the function list (near line 148): `{photo, replaced:{id, master_key}}`, errors NOT_ADMIN, PHOTO_NOT_FOUND, BYTES_MISMATCH, CONFLICT, STORAGE_FULL; update the sentence that names register_photo/delete_photos as the only photo write paths. `supabase/tests/data-model-doc.test.ts` keeps doc and golden in sync and must pass. |
| `scripts/architecture.golden.json` | `api.routes` gets `/photos/replace`; `photoWriteFunctions` gets `replace_photo`; the grants block (line 107) gets `"replace_photo": { "revokeFrom": ["public", "anon"], "grantTo": ["authenticated"] }`. |
| `scripts/gates-arch.mjs` | the comment and checks that enumerate the photo write functions (around line 107) learn the third function; run `npm run gates` to see what fails. |
| `scripts/api-surface.test.mjs` | the expected sorted route list (line 95) gets `/photos/replace`. `scripts/api-surface.fixtures.mjs` and `scripts/gates.test.mjs` get the matching fixture lines. |
| `docs/API.md` | new section `## POST /photos/replace` after `/photos/delete` (request, response, error codes, the order of events in section 2). |

## 7. Fakes and tests

Fakes (all offline, the real route must behave the same):
- `apps/admin/src/ports/api.ts`: add `replacePhoto(request, options?)` to the `Api` port.
- `apps/admin/src/adapters/fake/api.ts`: implement it with the same rules as the SQL (admin only, old exists, old != new, bytes check, quota with old bytes freed, move sort/alt/caption/cover/legacy_key, delete old row and its fake R2 objects, change_log and pending counter like delete + register). Add `'api.replacePhoto'` to the `FakeOp` list in `core.ts` so `failNext` works.
- `apps/admin/src/adapters/real/api.ts`: POST the request, parse with `ReplaceResponseSchema`.
- `apps/api/test/supabase-shim.ts` (the in-memory RPC shim used by the Worker tests): add `replace_photo` with the same semantics; `supabase-shim.test.ts` gets matching cases.
- `scripts/migrate-legacy/fake-backend.ts`: no change expected (the migration does not replace).

Tests (written together with the code after approval):
- `supabase/tests/photos-rpc.test.ts` (pglite or the project's SQL harness): happy path (fields copied, cover repointed, legacy key moved, old row gone, `bytes_total` sum changes by the difference); non-admin and anon refused; unknown old id; `old = new`; new id exists; bytes mismatch; quota full vs fits only because old bytes are freed; album unchanged; cover that pointed at another photo is untouched; atomic (a forced failure in step 12 leaves old row and cover as before).
- `apps/api/test/replace.test.ts`: route-level happy path (objects verified, old objects removed, `publishRecommended`), missing uploaded object, `failed` listing when R2 delete throws, 401/403 pass-through, schema errors, no secrets in logs.
- `apps/api/test/router.test.ts`: route table contains `/photos/replace` with method POST only.
- `apps/admin/src/screens/ReplacePhoto.test.tsx`: switch the screen from the client swap to `replacePhoto`; the recovery state "Nahrazení nedokončeno" can go away or stay for the failure before the call (decision in section 8); keep the happy path, failure, and rejected-file cases.
- `apps/admin/src/adapters/fake/world.test.ts`: the new port against the same cases as the SQL tests (fake vs real parity).
- `scripts/admin-check.mjs`: the "replace photo dialog and recovery" step is adapted to the new behaviour.
- Gates: `npm test`, typecheck, `npm run gates` green; golden diffs reviewed by hand.

## 8. Decisions for Adam

1. Approve option B at all (migration + Worker deploy), or keep option A (no approval needed, already built).
2. Does the replaced photo keep the old `created_at`? Keeping it means one more column copy in step 10 and keeps the album's "newest first" order; default is a new timestamp.
3. Do old-site image URLs of replaced legacy photos matter? Moving `legacy_key` keeps whatever resolves through it working; the lookup path on the public site has to be confirmed before building (no code was read for this document beyond the SQL).
4. One change_log entry ("replaced") or the two the existing triggers produce (insert + delete)? One entry needs a change to the change_log migration and the "Změny" screen.
5. Deploy order: migration first (additive, safe), Worker second, admin last. Needs the usual production-deploy approval; nothing is deployed by this document.

## 9. Size

About 1 migration, 1 route, 1 schema pair, 6 golden/doc edits, 2 fakes, 4 test files extended or added. Roughly one work package; no new dependency, no new secret, no live action until deploy.
