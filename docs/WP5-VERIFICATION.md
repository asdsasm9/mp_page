# WP-5 final verification (T-147, step WP5-32)

Date: 2026-10-20. Branch `autopilot`, working tree clean before this file was added. Everything below ran offline: the admin against its in-memory fake world, or the production bundle against mock servers on localhost, in headless system Chrome on macOS. Nothing was run against live Supabase, Cloudflare R2, Pages or a deployed Worker, and no live result is claimed. Commands ran one after another, never in parallel.

## Commands run

| Command | Result |
|---------|--------|
| `npm test` | exit 0. 115 test files, 2184 tests passed, 5 skipped, 101.7 s. jsdom prints "Not implemented: HTMLCanvasElement getContext" 24 times (the encoder tests use a stub surface; the real canvas is covered by `admin-encode-check`). |
| `npm run typecheck` | exit 0 for admin, api (src and test tsconfig), web, shared. |
| `npm run gates` | exit 0, "GATES OK". 22 PASS including the nine admin rules: admin-no-service-key, -no-signup, -no-html-inject, -no-photo-writes, -no-r2-hosts, -no-limit-literals (115 admin sources each), admin-dist-no-fake, -dist-no-keys, -dist-hosts (8 built files each). PENDING: `docs-complete` (owned by WP-8), the only one. `page-checks` repeats the known `[doplnit]` warning on `/cookies/` (cutover blocker, not WP-5). |
| `npm run admin-encode-check` | exit 0, `ADMIN_ENCODE: PASS`. 8 fixtures, no Exif/GPS in the master, 1600 JPEG or OG image, orientation applied, files equal the plan. Peak 388 ms per photo (6000x4000 JPEG), total 1330 ms, heap 2 to 3 MB. Same as the ADMIN.md table. |
| `npm run admin-check` | exit 0, `ADMIN_CHECK: PASS`. 57 page states (25 desktop 1280, 25 phone 390, 7 at 320). axe serious/critical 0 and all-violations 0 everywhere, overflow 0 px, smallest target 44 px, 0 console messages, 16 requests per profile. Worst layout shift 0.032 desktop, 0.074 phone. FCP 120 ms desktop, 56 ms phone. Upload of 5 photos with one PUT failing once: 2.9 s desktop, 3.2 s phone. Publish with 1.5 s fake build: about 6.1 s (5 s poll). |
| `npm run admin-prod-check` | exit 0, `ADMIN_PROD_CHECK: PASS`. Production build with real adapters against mock origins. JS fetched at start-up 726.0 kB raw / 210.2 kB gzip (limit 300 kB gzip), entry chunk 154.0 kB gzip, CSS 4.6 kB gzip. CSP: 0 violations while the app ran, probes allowed 5/5 and blocked 3/3. CSP header has no wildcard and no `unsafe-*`. 25 requests, all to the page or the mocks. The run printed "console messages: 5" and still passed; those are not itemised in the output (see finding 3). |
| `grep TODO\|FIXME` over `apps/admin/src` | no hit. |
| `git status --short` | empty before this file was written (check outputs go to the gitignored `.tmp/`). |

Plan extras of WP5-32 (run in a second pass, also one after another):

| Command | Result |
|---------|--------|
| clean install (`npm ci`) | SKIPPED on purpose: it deletes and reinstalls `node_modules` (about 1 GB of packages, needs the network, and would break the other checks if it failed half way). The lockfile is covered by the `no-dead-deps` gate and the exact-pin tests. Not claimed. |
| `npm run build -w apps/admin` | exit 0. Fake-free build without `VITE_*` set: entry 520.31 kB raw / 159.46 kB gzip, real adapters 222.86 kB / 58.01 kB gzip, CSS 24.14 kB / 4.73 kB, `dist/_headers` written (0.69 kB). (`admin-prod-check` builds with the five origins and measures 154.0 kB entry; the difference is the env-driven code paths.) |
| `npm run lightbox-a11y` | First two runs FAILED at the step "close button: focus returns to the 3rd thumbnail" (TimeoutError in `ready()`, 30 s) after 38 ok lines. Cause: stale `apps/web/dist`, built before the T-113 weight-model change; not a WP-5 or script defect. After `npm run build -w apps/web` the third run passed: `LIGHTBOX_A11Y: PASS` (all keyboard, zoom, reduced-motion, axe and CDP touch checks). |
| `npm run design-check` | exit 0, `DESIGN_CHECK: PASS` for the public site (7 pages, axe 0, overflow 0, console 0, Lighthouse perf 0.98 to 1, a11y/bp/seo 1, worst LCP 2478 ms, CLS 0). This script covers `apps/web`, not the admin; the admin was not touched visually in this task, so I opened no screenshots. The admin's own visual evidence is `admin-check` (screenshots under `.tmp/admin-check/shots`). |

## WP-5 acceptance and the 21 goals

The 21 goals are the table in `docs/ADMIN-UX.md` section 9, mapped to a test file and filter in `docs/ADMIN.md` ("The 21 goals and the tests that prove them"). `apps/admin/src/a11y/goals.test.ts` fails if a file, a filter or a goal is missing, and it passed inside `npm test`. So the 21-goal table is complete and every row resolves to an existing, passing test.

| Criterion | Evidence | Status |
|-----------|----------|--------|
| VISION goal 3, categories: create, rename, reorder, hide, delete | goals 2 to 6 (`CategoriesScreen.test.tsx`), flows F1 in `admin-check` | Verified in fake world |
| VISION goal 3, albums: create, edit title/place/date/description/SEO/slug, reorder, cover, publish/unpublish, delete | goals 7 to 12 (`CategoryScreen`, `AlbumScreen`, `PhotoGallery`, `Delete` tests) | Verified in fake world |
| VISION goal 3, photos: many at once, resized and converted in the browser, reorder, alt and caption, move, delete | goals 13 to 17; `admin-encode-check` on the real encoder; `admin-check` uploads 5 photos through it | Verified in Chrome, fake backend |
| Changes reach the public site without a developer | goal 18 (`PublishScreen.test.tsx` "full sequence"); publish flow in `admin-check` | Fake world only; real Worker, deploy hook and `_publish.json` polling unverified (rows 28, 31) |
| Page texts not editable | goal 20 (`a11y/scope.test.tsx`: route table is the information architecture) | Verified |
| Simple on a laptop, small edits on a phone | goal 19: keyboard flow test, phone bottom nav test, `admin-check` at 390 and 320 px, all targets at least 44 px | Emulated phone only; real phone unverified (rows 26, 24) |
| Storage bar, warning, refusal, reconcile | goal 21; limits come from the Worker response, gate `admin-no-limit-literals` PASS | Fake world only |
| Login, one owner, no sign-up | goal 1; gates `admin-no-signup`, `admin-no-service-key` PASS | Client side verified; Supabase settings are human (row 32) |
| Accessibility WCAG 2.2 AA | axe in 20 states in jsdom (`a11y/audit.test.tsx`), plus axe with contrast in 57 real-browser states, 44 px targets, keyboard session, reduced motion | Verified in Chrome; screen readers and other browsers not tested |
| Security: no service key, no HTML injection, no direct `photos` writes, no R2 host, no fake marker or keys in dist, CSP with exact origins | nine admin gates plus CSP probes in `admin-prod-check` | Verified against mocks |
| Bundle budget | 210.2 kB gzip JS against a 300 kB limit | Within budget (above the 170 kB public-page default, accepted for a one-user tool, see ADMIN.md) |

## Only offline or mocked

- The whole data path: Supabase auth and PostgREST, the Worker, R2 presigned `PUT`, the deploy hook and the public `_publish.json` were fakes or localhost mocks.
- Encoding was run in desktop Chrome only (WebP output, memory, time). Only the `createImageBitmap` decode path was exercised, not the `<img>` fallback.
- Phone behaviour is Chrome with touch emulation, not a real device. Timings are headless Chrome with a fake backend and are not Lighthouse numbers.
- CSP was enforced against mock origins on 127.0.0.1; the real origins come from the Pages variables.
- Browser coverage: Chrome only. Safari, Firefox, and the browser the photographer actually uses are untested.

## Deviations (recorded in `docs/ADMIN.md`, none removes a goal)

Fourteen are listed there. The ones worth knowing: two album badges instead of four (Zveřejněno / Nezveřejněno), no "use the real value" step in reconcile (WP-4 decision), upload queue lost on reload, duplicate check per session only, no HEIC library, pending changes shown as a count and a dot without a list, inline buttons instead of an overflow menu, zod in `jitless` mode for the CSP.

## Findings (not fixed)

1. CLOSED. The literal WP5-32 extras were run in a second pass (see the table above). Only `npm ci` was skipped, with the reason given. `lightbox-a11y` needs a fresh `apps/web/dist`; a stale one makes it time out at the third-thumbnail step. Consider building the web in the script's usage line or having it say "stale dist" (not changed).
2. `admin-check` listed about 32 screenshot paths while 57 states were checked; not every state is saved as a file, only the main ones. Nothing is wrong, noted for readers.
3. CLOSED. `admin-prod-check` now prints every console message and labels it. The five are exactly the deliberate CSP probes the script fires at the end (fetch and image to `127.0.0.1:9`, one inline script): two "violates connect-src" and "Fetch API cannot load" lines, one image violation plus its "request failed", and one inline-script violation. They are expected noise, not a problem; the app flow itself produced 0 messages and 0 CSP violations. Change: `scripts/admin-prod-check.mjs` prints `[expected: deliberate CSP probe]` or `[JUDGED]` per message (judging logic unchanged). The run still passes: `ADMIN_PROD_CHECK: PASS`.
4. Colour of the accent button (muted tan) and the "Nahrávání: 0" label after a finished batch are open observations from WP5-28; no change here. Brand colour stays H-3.
5. No discrepancy needed a code change. No source file was edited by this task.

## Left to a human (nothing below was run)

All are in `docs/VERIFY.md` rows 24 to 32 (also "Needs a human" rows 24 to 32) with steps, and in `docs/ADMIN.md` "Deploying the admin":

- Row 25: WebP encoding in Safari and Firefox.
- Row 26: 10 full-size photos from her real phone (memory, time per photo, queue lost if the tab dies).
- Row 27: R2 CORS and the browser `PUT` to a presigned URL; related row 4 (R2 rejects a body that differs from the signed content-length).
- Row 28: `PUBLIC_ADMIN_ORIGIN` set on the web project and the header on `/_publish.json`.
- Row 29: real session refresh, expiry and the "Přihlášení vypršelo" modal.
- Row 30: what the admin shows when the Supabase project is paused.
- Row 31: SPA fallback and the generated CSP and `_headers` on the deployed Pages project.
- Row 32: Supabase sign-ups off, the Google provider plus two `admin_emails` rows (WP-09), redirect URL, third-account and non-admin test.
- Create the Pages project and set the six `VITE_*` variables; H-8 extended to the admin (5 photos from her real phone and laptop); H-3 brand colour.
- Decisions listed under D-9 in the plan (dependencies, browser she uses, deviations) if not already answered.

## Verdict

PASS for offline verification of WP-5: every command exited 0, all 21 goals map to passing tests, gates are green except `docs-complete` (WP-8). Live behaviour is UNVERIFIED.
