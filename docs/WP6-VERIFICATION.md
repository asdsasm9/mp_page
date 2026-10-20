# WP-6 final verification (T-162, step WP6-15)

Date: 2026-10-20. Branch `autopilot`, working tree clean before this file was added. Everything below ran offline: the migration against its in-memory fake backend or as a dry-run over the real `legacy/fotky_web/galleries/` files. Nothing was run against live Supabase, Cloudflare R2 or a deployed Worker, `--live` was never run, and no live result is claimed. Commands ran one after another, never in parallel.

## Commands run

| Command | Result |
|---------|--------|
| `npm test` | exit 0. 126 test files, 2342 tests passed, 5 skipped, 121.5 s. jsdom prints "Not implemented: HTMLCanvasElement getContext" 24 times (admin encoder tests use a stub surface; known from WP-5). |
| `npm run typecheck` | exit 0 for admin, api (src and test tsconfig), web, shared and `scripts/tsconfig.json` (which covers `scripts/migrate-legacy*`). |
| `npm run gates` | exit 0, "GATES OK". All PASS, including the five migrate gates (`migrate-no-service-key`, `-no-signup`, `-no-photo-writes`, `-no-r2`, `-no-credentials`; 14 migrate-legacy sources each). PENDING: `docs-complete` (owned by WP-8), the only one. `page-checks` repeats the known `[doplnit]` warning on `/cookies/` (cutover blocker, not WP-6). |
| `npm run migrate-legacy` (dry-run, run 1) | exit 0, `RESULT: OK`. See numbers below. |
| `npm run migrate-legacy` (dry-run, run 2) | exit 0, same output; 35.9 s wall (136 s user CPU, 4 cores). |
| `grep TODO\|FIXME` over `scripts/migrate-legacy.ts` and `scripts/migrate-legacy/` | no hit. |
| `npm ci` | SKIPPED on purpose: it deletes and reinstalls `node_modules`, needs the network and would break the other checks if it failed half way. Not claimed. |
| `git status --short` | empty before this file was written (`migration-report/` is gitignored). |

### Dry-run numbers (real 141 files)

- Categories 3, albums 13, photos 141, planned 141 of 141, failed 0, `RESULT: OK`.
- Source bytes 130,524,912 (124.5 MB). Planned R2 bytes 161,438,037 (154.0 MB), from real encoded sizes. That is about 1.6% of the 9.5 GB hard limit.
- Per album (found = planned, bytes, cover): frankovi 5, 6,645,661, #1; hradsti 8, 7,577,768, #2; sedlakovi 44, 52,579,434, #42; suranovi 5, 5,918,229, #1; anez 9, 8,119,970, #9; lucka 5, 3,743,854, #1; lukas 7, 9,236,183, #1; mia 20, 20,296,890, #1; pati 12, 14,834,360, #5; pati2 4, 2,890,466, #1; pavla_rafael 11, 14,089,616, #1; helis_tom 6, 8,523,868, #1; lucka_filip 5, 6,981,738, #1. Order OK in all 13.
- Redirect lines 141.
- Byte-identical check: stdout of the two runs is identical. `diff` of `legacy-image-redirects.txt` (run 1 copy vs after run 2) is empty, and `diff` of the run 1 and run 2 `.json` and `.md` reports is empty (the file name carries the timestamp, the content does not).

## Acceptance table

| Criterion | Evidence | Status |
|-----------|----------|--------|
| 3 categories, 13 albums, 141 photos | dry-run above; `sources.test.ts` "finds 141 files in 13 albums with the CONTENT-MAPPING counts"; `scripts/migrate-legacy.test.ts` "plans 3/13/141" | Verified (real files, offline) |
| Idempotent second run | `resume.test.ts` "full 141-photo fake run: second run inserts 0 and skips 141 with identical counts"; `upload.test.ts` "a second run skips the existing rows and reserves nothing"; `catalog.test.ts` "a second run adds nothing" | Verified in fake backend |
| Crash resume | `resume.test.ts` "a run killed after the PUTs but before a commit completes on rerun without duplicates or orphans" | Verified in fake backend |
| Quota refusal | `upload.test.ts`: limit hit mid-run stops at first refusal with `used <= hard`; pre-flight refuses with zero writes (also through `main`, not even the catalog is written); warn level; `--limit-bytes` below need; `FileTooLarge` aborts before any PUT; `fake-backend.test.ts` STORAGE_FULL at the hard limit | Verified in fake backend. Real quota figures: VERIFY row 34 |
| EXIF/GPS check | `image.test.ts`: orientation applied and EXIF/GPS stripped from every output; negative test (an encoder keeping metadata is caught by `hasExif`); dimensions equal plan, `variantsMatchPlan`, 720 for masters of 720 or more, `bytes_total == sumBytes`, deterministic. Dry-run encodes all 141 real files through the same sanity checks (failed 0) | Verified with sharp on synthetic fixtures and the 141 real files. Output on live R2: VERIFY row 35 |
| Cover and order | `cover.test.ts` "full live run, 141 photos: all 13 covers per the table, orders are 1..n, a rerun changes nothing"; different cover = drift only; dry-run prints cover #42 (sedlakovi), #9 (anez), #2 (hradsti), #5 (pati) and `order OK` | Verified in fake backend |
| Redirect file | dry-run writes 141 lines, `migrate-legacy.test.ts` format test and byte-identical-twice test; file identical across my two real runs | Verified for dry-run. Live-vs-dry-run equality is not tested (finding 1) |
| Secrets | gates `migrate-no-*` (with violating fixtures in `gates.test.mjs`); sentinel password and token tests in `http-backend.test.ts`, `catalog.test.ts`, `alt-report.test.ts` (live report files hold no secrets); guard failures print codes only | Verified |
| Safety flags | `http-backend.test.ts`: every guard failure exits 2 with zero requests (no `--live`, wrong or missing confirm, non-https, odd or look-alike hosts, userinfo URLs, missing credentials); non-admin stops after sign-in with no write | Verified against fake HTTP |

## The 13 test items of the plan (section 5) mapped to tests

| # | Item | Test | Status |
|---|------|------|--------|
| 1 | plan/counts 3/13/141, per album | `sources.test.ts` (real files), `migrate-legacy.test.ts` dry-run | Covered |
| 2 | idempotency | `resume.test.ts` full 141 run twice; `upload.test.ts` second run | Covered |
| 3 | crash resume | `resume.test.ts` "crash resume"; `fake-backend.test.ts` "crash between PUT and commit" | Covered |
| 4 | order and covers (13) | `cover.test.ts` full run; `upload.test.ts` file-number order | Covered |
| 5 | variants equal plan, 720, master <= 3000, bytes_total | `image.test.ts` (synthetic 964, 1480, 3162 px and portrait); `fake-backend.test.ts` 720 rule. Not asserted per real file in a test, but the dry-run applies the same sanity checks to all 141 | Covered |
| 6 | EXIF/GPS stripped, negative test | `image.test.ts` | Covered |
| 7 | colour format and determinism | `image.test.ts` (format and a==b), `upload.test.ts` (format in commit), `dev-images.test.ts` (shared function) | Covered |
| 8 | alt | `alt-report.test.ts` (valid and unique for all 141, null by default, `--alt default`) | Covered |
| 9 | quota | `upload.test.ts` preflight, mid-run refusal, warn | Covered |
| 10 | safety | `migrate-legacy.test.ts` (dry-run no network, `--live` not accepted by dry-run path), `http-backend.test.ts` (exit 2, non-admin) | Covered |
| 11 | secrets | gates plus sentinel tests (see above) | Covered |
| 12 | redirect file: 141 lines, ids equal committed ids, identical dry-run vs live | 141 lines and dry-run determinism covered; "ids equal the ids committed in a live fake run" and "identical to the live run's file" are NOT tested | PARTIAL (finding 1) |
| 13 | drift reported, not overwritten | `catalog.test.ts` (renamed or re-sorted album), `cover.test.ts` (different cover), `fake-backend.test.ts` (upsert never overwrites) | Covered |

## Only offline or fake

- Supabase auth, PostgREST, the Worker reserve/commit and R2 presigned PUT are the in-memory `FakeBackend` or localhost-style fake HTTP in tests. `HttpBackend` has only been run against fake `fetch`.
- Real quota figures, the first real presigned PUT with content-length (VERIFY row 4 and rows 33 to 36), sharp output served from live R2, and the password grant (TOTP may block it, then `MIGRATE_ACCESS_TOKEN`) are unverified.
- The dry-run numbers are real (real files, real sharp encoding) but nothing was uploaded.
- 154.0 MB planned is well below the plan's estimate of 300 to 420 MB. The estimate was a guess; the real figure comes from the actual encoded sizes. Re-check the live figure in VERIFY row 34.

## Deviations from the plan

1. Exit codes: guard failures (flags, host, credentials) exit 2 before any request, as planned. Sign-in failure, `NOT_ADMIN`, quota refusal, an unknown `--album` and any INCOMPLETE result exit 1 (documented in `docs/MIGRATION.md`; a docs test guards that it does not claim exit 2 for a sign-in failure).
2. `objectExists(key)` was added to the `MigrationBackend` interface (T-149) to detect missing objects (public HEAD in `HttpBackend`).
3. The admin fake world was not reused; `FakeBackend` is its own implementation (T-149), kept honest by contract tests.
4. Live `--repair` is unsupported (D-11 OPEN-INFO): the Worker reserve refuses an existing photo id with `CONFLICT`. Repair works against the fake only; the live per-item failure carries a clear label. Documented under "Live --repair limitation" in `docs/MIGRATION.md`.
5. Per-item reserve refusal handling: an unexpected per-item refusal code (and a photo the reserve answer leaves out) fails only that photo with a generic label and the run continues; only STORAGE_FULL and FILE_TOO_LARGE abort the whole run (T-157 fixed the earlier mislabelled abort).
6. `dominantColorOf` moved to `scripts/dominant-color.ts`; `scripts/tsconfig.json` was added and is part of `npm run typecheck`.
7. `docs/MIGRATION.md` and VERIFY rows 33 to 36 exist; `docs-complete` stays PENDING (WP-8).

## Findings (not fixed)

1. Test gap, plan item 12 (small): no test asserts that the redirect file lines carry the ids that a live fake run committed, or that the dry-run and live files are identical. Ids come from the same UUIDv5 function in both paths, and a pinned id test exists in `sources.test.ts`, so the risk is low. Suggested follow-up task.
2. Unexpected-exception path in the upload/cover phase writes no report files (T-159 note). Console output still shows the failure; the run exits non-zero.
3. Catalog drift is printed but not written to the JSON/MD report files (T-159 note).
4. Images are encoded twice in a live run (once for the size/pre-flight plan, once for upload) (T-156 note). This costs time only (the dry-run takes about 36 s for 141 files, a live run roughly double plus network).
5. Several tests (live-mode ones with a 618-byte report) write report files into the repo's gitignored `migration-report/` instead of a temp dir; it held about 150 files after the test run. Harmless (gitignored) but noisy; the folder also holds the real dry-run outputs, so a human should not read it as "the" report without checking the timestamp.
6. `PublishScreen.test.tsx` had a timing flake once under full-suite load in T-159; it did not recur in this run.
7. No discrepancy needed a code change. No source file was edited by this task.

## Left to a human (nothing below was run)

- H-10: the live run, `npm run migrate-legacy -- --live --confirm-project <ref>`, first `--album lucka_filip`, with the second admin account, following `docs/MIGRATION.md`.
- VERIFY rows 33 to 36 (first real presigned PUT through the script, real quota figures, sharp output on live R2, and the post-run checklist), plus row 4 (R2 and content-length) beforehand.
- Decision on D-11 (live repair of an existing photo with missing files): needs a Worker change or a manual delete-and-rerun, see `docs/MIGRATION.md`.
- Hand the redirect file to WP-3/WP-8; switch it on only after H-5.

## Verdict

PASS for offline verification of WP-6: every command exited 0, the real dry-run plans 3/13/141 with 154.0 MB for R2 and byte-identical output on a second run, 12 of 13 plan test items are fully covered and item 12 is partial. Live behaviour is UNVERIFIED.
