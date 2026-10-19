# WP-4 final verification (T-94, step WP4-21)

Date: 2026-10-19. Branch `autopilot`, working tree clean before this file was added. Everything below ran offline against fakes and the PGlite shim. Nothing was run against live Supabase, Cloudflare R2, Pages or a deployed Worker, and no live result is claimed.

## Commands run

| Command | Result |
|---------|--------|
| `npm test` | exit 0. 70 test files, 1211 tests passed, 73.9 s. |
| `npm run typecheck` | exit 0 for admin, api (src and test tsconfig), web, shared. |
| `npm run build` | exit 0. Astro: 22 pages built; postbuild wrote `_redirects`, `_headers`, `_publish.json` (local fixture). Admin: Vite build, 1 JS bundle 140.66 kB (45.69 kB gzip). |
| `npm run gates` | exit 0, "GATES OK". PASS: no-secrets, no-service-role, no-env-files, env-example-sane, no-legacy-ids, no-dead-deps, no-direct-r2, no-ga-in-dist (23 html), migrations-lint (9), page-checks (22 pages), budget (21 pages), quota-guard-tests (11 cases present), api-hygiene. PENDING: docs-complete (owned by WP-8). |
| `npm run gates -- --strict` | exit 1 as expected: "pending counts as FAIL: docs-complete". The pending list is only `docs-complete`, as the plan requires. |
| `npx wrangler deploy --dry-run --outdir <scratchpad> --config apps/api/wrangler.toml` | exit 0, no login needed. Bundle 844.26 KiB, gzip 139.15 KiB. Bindings listed: `PHOTOS` (mullnyphotos) and `BACKUP` (mullnyphotos-backup), both R2. Nothing deployed. Output went to the session scratchpad, not the repo. |
| `git status --short` | empty before this file was written. |
| grep `service_role` over apps, packages, scripts, supabase, docs | only `scripts/gates.mjs` (the gate itself) and `supabase/tests/{lint.test.ts,helpers/*}` (tests asserting it is absent / stub roles). No hit in `apps/` or `docs/`. |
| grep `aws4fetch\|R2Bucket` over apps, packages, scripts | `apps/api/package.json` (the pinned dependency), `apps/api/src/storage/{r2.ts,fake-bucket.ts,bindings.ts,r2.test.ts}`, and `scripts/gates.mjs` / `scripts/gates.test.mjs` (the gate's own patterns). Nothing outside the allowed storage folder except the dependency declaration and the gate. `no-direct-r2` PASS agrees. |
| `git log --oneline -- legacy` | only `8c11553` (WP-1 move). Nothing under `legacy/` changed in WP-4. |
| Secret scan | `no-secrets` and `env-example-sane` gates PASS. I did not open any `.env` file. |

## Acceptance of WP4-21

- All commands exit 0: yes (the one non-zero is the intentional `--strict` run).
- Strict pending list is only `docs-complete`: yes.
- No `service_role`, no secret values, aws4fetch/R2Bucket confined: yes (see table).
- Nothing under `legacy/` changed: yes.
- No wrangler login or deploy: yes (dry run only).
- `git status` clean after commit: not applicable, this task does not commit. The tree now contains this file and a VERIFY.md edit, to be committed by the orchestrator.

## Comparison with MASTERPLAN (read from code, docs and test output, not a live system)

| MASTERPLAN item | Built Worker | Status |
|-----------------|--------------|--------|
| Worker "api" with R2 bindings public and private backup bucket | `wrangler.toml` binds `PHOTOS` and `BACKUP`; dry-run confirms. | Matches |
| Endpoints: GET /storage, POST /uploads/reserve, /uploads/commit, /photos/delete, /storage/reconcile, /publish, daily cron | `docs/API.md` has a section for each plus `GET /health` and the scheduled handler. The route table versus API.md test exists per WP4-20. | Matches |
| Cron keepalive daily | `crons = ["17 3 * * *"]`; handler covered by tests. Free-plan support of the trigger is unverified (VERIFY row 3). | Matches, live part open |
| Auth: Bearer JWT, verified by `is_admin` RPC with the caller's JWT, no service-role key | Covered by auth tests (fail closed on upstream error, no token in logs); `no-service-role` gate PASS; secrets list in `docs/DEPLOY-API.md` has only the anon key. | Matches |
| Secrets: R2 S3 key (presign only) and deploy hook URL as Worker secrets | `DEPLOY-API.md` lists `wrangler secret put` for SUPABASE_URL, SUPABASE_ANON_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_BACKUP_BUCKET, R2_PUBLIC_BASE_URL, PAGES_DEPLOY_HOOK_URL, ALLOWED_ORIGINS. `env.ts` reads the same names. `wrangler.toml` holds bucket names only. | Matches (see finding 2) |
| Security: exact-origin CORS, no credentials, no-store, nosniff, body limits, rate 1 publish per 60 s, quota refusal | Covered by the WP4-3, 4, 15, 18 suites, all in the 1211 passing tests. | Matches |
| Quota guard (T-6, D-7): reservation, exact sizes, signed content-length, DB backstop, reconcile, limits in `app_config` | `quota-guard.test.ts` with 11 fixed titles, gate `quota-guard-tests` PASS, includes a case that changes `quota_hard_bytes`. | Matches |
| Snapshot plus full backup on publish, last 20 backups, deploy hook | `publish-service` and `/publish` suites pass. Snapshot for 4000 photos is 2,086,716 bytes, under 6 MB (VERIFY row 13). | Matches |
| Cost 0 EUR | Only free-plan features used; no paid service added. Whether publish fits free Worker CPU is unmeasured (VERIFY row 13). | Open, human |
| Logging hygiene | Redacting logger; test asserts no token or Authorization in output; `api-hygiene` gate PASS. | Matches |

T-6 acceptance (plan section 6, eleven cases): the 11 titles are present (gate) and `npm test` passed, which includes `apps/api/test/quota-guard.test.ts`. I did not re-read each case title against the plan text; the gate does that comparison.

## Deviations from plan / MASTERPLAN

1. Web app has no Tailwind (MASTERPLAN section 3 says Tailwind). Already recorded as WP-3 decision 1 / D-6 in the plan; not new.
2. Reconcile has no "stored correction value"; the ADMIN-UX 3.7 "Použít skutečnou hodnotu" button is dropped (WP-4 decision 4). WP-5 must know.
3. `legacy_key` accepted on commit and `uploaded` / `cacheControl` added to the shared storage adapter (WP-4 decision 7). Additive.
4. MASTERPLAN section 4 lists reservation TTL 60 min while the presigned URL lifetime is 15 min (`X-Amz-Expires=900`); the plan separates the two (URL 15 min, reservation per `app_config.reservation_ttl_min`). Not a defect, noted for readers.
5. Publish step skips the decision-ladder step 1 (skip validation in the Worker); deliberately not applied until a real CPU measurement exists (VERIFY row 13).

## Findings (not fixed, not code changes)

1. VERIFY row 15 said `wrangler deploy --dry-run` was not run; it now has. Row updated (the "network off" caveat remains open).
2. `ALLOWED_ORIGINS`, `R2_BUCKET`, `R2_BACKUP_BUCKET` and `R2_PUBLIC_BASE_URL` are non-secret values but DEPLOY-API.md has them set with `wrangler secret put`. Works, but they could be plain `[vars]`; a style choice for a human, no action taken.
3. `npm run gates` prints a `[doplnit]` marker warning on `/cookies/` (controller details). This is the known cutover blocker from plan decision 8, not a WP-4 matter.
4. `npm run build` ran with network available, so "builds with no network" is still unproven.
5. The wrangler dry run printed a telemetry notice; it did not log in or deploy. Setting `WRANGLER_SEND_METRICS=false` would avoid it in future runs.

## Left to a human (nothing below was run)

All items need live accounts and are listed with steps in `docs/DEPLOY-API.md` section 9 and `docs/VERIFY.md` "Needs a human":
- R2 bucket-scoped API token, bucket CORS for admin origins, private backup bucket, `wrangler secret put` values, Pages deploy hook, optional WAF rate-limit rule.
- Whether R2 rejects a PUT whose body differs from the signed content-length (row 4).
- Whether cron triggers work on the free plan, and the 8-day Supabase pause check (rows 3, 11).
- Real Worker CPU time and subrequest count for a full publish, and the current free-plan limits (row 13). Decide on the ladder if over the limit; Workers Paid (about 5 USD per month) needs Adam's explicit approval.
- Real PostgREST status codes for `raise exception` messages (e.g. `STORAGE_FULL`), R2 operation counts in the free tier, R2 location (row 6).
- Approval decisions listed under "WP-4" in the plan (aws4fetch pin, immediate R2 deletion on delete, draft photo exposure, `register_photo` direct-call limitation, which admin preview origin to allow).

## Verdict

PASS for offline verification. Live behaviour is UNVERIFIED.
