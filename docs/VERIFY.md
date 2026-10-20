# Verification notes (TO VERIFY items)

Written 2026-10-19 by a builder with no web access. Statuses: VERIFIED (evidence required), UNVERIFIED, HUMAN, FAILED.
Rule: a forum post alone is never VERIFIED; prefer vendor docs and note the date read. Nothing below was read from the web.

| # | Item | Why it matters | How to verify | Who | Status | Evidence (date) | Consequence for the plan |
|---|------|----------------|---------------|-----|--------|-----------------|--------------------------|
| 1 | PGlite RLS | Migrations and RLS must be testable offline | Run `npm test`, see `supabase/tests/pglite-capability.test.ts` | builder-offline | VERIFIED | `supabase/tests/pglite-capability.test.ts`, 9 tests pass (2026-10-19). SET ROLE, RLS policy hiding rows, column grants, security definer with `set search_path=''`, `revoke execute from public`, and `auth.uid()` from the claim all work. | WP-2 tests run on PGlite. Migrations must `revoke ... from public, anon` explicitly, because the stub (like Supabase) grants permissively by default. |
| 2 | Pages vs Workers static assets; deploy-hook support for Astro | Decides the hosting target and how publish triggers a build | Read current Cloudflare docs (Pages, Workers static assets, deploy hooks); confirm in a real WP-8 or Phase 3 preview | builder-with-WebSearch, then human | UNVERIFIED | none (no web access) | Hosting choice stays provisional; publish flow must not depend on a deploy hook until confirmed. |
| 3 | Cron triggers on the Workers free plan | Keepalive and backup jobs depend on them | Read Workers pricing/limits docs; confirm in the dashboard at deploy | builder-with-WebSearch, then human | UNVERIFIED | Offline (2026-10-19): `apps/api/wrangler.toml` has `crons = ["17 3 * * *"]`, the `scheduled` export is covered by `apps/api/test/publish-keepalive.test.ts`. Whether the free plan accepts the trigger is not known (no web access, no deploy). | If unavailable, use an external scheduler or a manual trigger. Human step: `docs/DEPLOY-API.md` sections 3, 8 (Triggers tab) and the 8-day check in section 9. |
| 4 | R2 presigned PUT enforcing content-length | Upload size limits and quota | Local signing can be checked offline in WP-4; enforcement needs a live bucket test | human (Phase 3 live step) | HUMAN | Offline (2026-10-19): the signed URL carries `content-type`, `content-length` and `cache-control` as signed headers (`apps/api/src/storage/r2.ts`, `r2.test.ts`). Whether R2 REJECTS a PUT with a different length is untested. | HEAD at commit, DB backstop and reconcile stay mandatory regardless. Human test: `docs/DEPLOY-API.md` section 9 step 3 (PUT a wrong-length body, write down accepted or rejected; if accepted, commit must answer 422 `KEY_MISMATCH`). |
| 5 | Supabase TOTP/MFA on the free plan | Admin login hardening | Read Supabase docs; Adam confirms in the dashboard | human | HUMAN | none | If not on free, fall back to a strong password plus single admin allowlist. |
| 6 | R2 data location and jurisdiction | GDPR statements | Read R2 docs; Adam checks the bucket settings | human | HUMAN | none | Do not claim EU-only anywhere until confirmed. |
| 7 | Pages build limits (builds per month, time) | Publish frequency | Read Cloudflare Pages limits docs | builder-with-WebSearch | UNVERIFIED | none | Publish may need debouncing. |
| 8 | r2.dev rate limits | Previews without a custom domain | Read R2 public bucket docs | builder-with-WebSearch | UNVERIFIED | none | Matters only if no custom domain is ready for previews. |
| 9 | HEIC decode in the browser (library, licence, size; real iPhone/Safari behaviour) | Photo upload from phones | Docs and library lookup; test with a real HEIC photo on iPhone and Safari | builder-with-WebSearch, then human | HUMAN | none | Upload flow may need server-side or camera-JPEG fallback. |
| 10 | Cloudflare Web Analytics cookieless claim and default behaviour | Consent banner decision | Read docs; check browser network panel and cookies on a Phase 3 preview | builder-with-WebSearch, then human | HUMAN | none | See docs/ANALYTICS-CONSENT.md; keep analytics off until confirmed. |
| 11 | Supabase free-project pause policy (inactivity period; whether a PostgREST RPC counts) | Site data could disappear behind a paused project | Read Supabase docs; observe the daily keepalive for at least 8 days | human | HUMAN | none | Keepalive design is provisional. |
| 12 | Current prices and free-tier numbers (R2 10 GB and operations, Supabase Free, Workers 100k requests/day, Pages) | Quota guard constants and cost claims | Read each vendor pricing page, record with date | builder-with-WebSearch | UNVERIFIED | none | Quota numbers in WP-2/WP-4 are placeholders until recorded. |
| 13 | Workers free-plan limits for WP-4 (subrequests per request, CPU time, body size, whether publish fits one request) | Batch reserve must be one RPC; publish job design | Read Workers limits docs; measure a real publish in the Worker's live logs | builder-with-WebSearch, then human | UNVERIFIED (limits and real Worker CPU); size and Node timing measured below | **Free-plan CPU and subrequest figures: not readable here (no web access); the plan's recollection is about 10 ms CPU per request, unconfirmed. No Workers CPU figure is claimed.** Local measurement, 2026-10-19, `npm run bench:snapshot` (Node v22.23.1, NOT the Workers runtime, indicative only, one dev machine): synthetic catalog 4000 photos / 50 albums / 5 categories / 200 redirects. Snapshot JSON 2,086,716 bytes (1.99 MiB), under the 6 MB limit (asserted by `apps/api/test/snapshot-size.test.ts`). `buildSnapshot` (it already runs one full `SnapshotSchema.parse` inside): first call 41 ms, median 19 ms. `JSON.stringify`: median 5 ms. `JSON.parse` + a second full `SnapshotSchema.parse` (what the Astro build does): median 25 ms. Not measured: the PostgREST reads and the JSON parsing of 4000 photo rows, the backup serialisation, R2 writes, TLS; these also cost CPU in a real publish. Subrequests per publish by code reading: auth check 1, `request_publish` 1, four table reads (more if paged), backup `put`, list for pruning (plus deletes), snapshot `put`, deploy hook 1, `record_publish` 1: roughly 12 to 15, to compare with the free-plan subrequest limit once read. | Decision ladder (D-7, step 1 skip full validation in the Worker, then paid plan, then move the build): **outcome pending a human measurement.** Node CPU for build plus stringify is already about 25 ms at 4000 photos, which is more than the unconfirmed 10 ms figure, so ladder step 1 is plausible. It was NOT applied: the validation is inside the shared `buildSnapshot`, changing it is a shared-contract change that should wait for a real measurement, and Node timing cannot prove or disprove the Worker limit. Human step: `docs/DEPLOY-API.md` section 9 step 8 (publish with the real catalog, read CPU time in the live logs). If over the limit: add an option to skip validation in the Worker only (the Astro build validates again) before any paid plan (about 5 USD per month would break the 0 EUR cap and needs Adam's approval). |
| 14 | R2 "GB" decimal or binary | Margin of the 9.5e9 hard limit | Read R2 pricing docs | builder-with-WebSearch | UNVERIFIED | none | 9.5e9 keeps margin under either reading of 10 GB (10e9 decimal, about 10.74e9 binary). |
| 15 | Local offline build (web and admin); optional `wrangler deploy --dry-run` | Skeleton must build without services | `npm run build` | builder-offline | UNVERIFIED | `npm run build` exited 0 on 2026-10-19 and produced `apps/web/dist/index.html` and `apps/admin/dist/index.html`. The sandbox had network access, so "works with no network" is not proven. `apps/api` `wrangler deploy --dry-run --outdir <scratch>` exited 0 on 2026-10-19 without login (bundle 844 KiB, gzip 139 KiB, R2 bindings PHOTOS and BACKUP listed); nothing was deployed. | Re-run with the network off to close this row. |
| 16 | Exact dependency versions, Node, npm audit | Reproducible installs | See below | builder-offline | VERIFIED | `package.json` files read 2026-10-19; `npm audit` run once | All pinned exactly; lockfile committed. |
| 17 | Pages `_redirects` limits (static rule count, 410 status support, wildcard behaviour) | `redirects.ts` emits up to 1900 rows and may emit 410 rows | Read Cloudflare Pages redirects docs, then test on a preview | builder-with-WebSearch, then human | UNVERIFIED | none (no web access, 2026-10-19) | Generator fails the build above 1900 rows; 410 rows are dropped (path then 404s) until verified. |
| 18 | Pages rule for `/index.html` and `/x/index.html` (does Pages strip it, does `trailingSlash: always` match) | Canonical URLs and legacy links | Preview deploy, `curl -I` on `/svatby/index.html` | human | HUMAN | none | Canonical URLs always end with a slash; no rule depends on this. |
| 19 | CSP `style-src-attr` support (old Safari) | Per-photo `--c` placeholder colour is an inline style attribute | MDN / caniuse, then check on an iPhone | builder-with-WebSearch, then human | UNVERIFIED | none | Failure only drops the placeholder colour, nothing else. |
| 20 | Astro image API in the installed 7.4.0 | `Picture`, `getImage`, `build.inlineStylesheets` used by WP-3 | Read installed types | builder-offline | VERIFIED | `apps/web/node_modules` resolved to `node_modules/astro` 7.4.0: `astro/client.d.ts` declares `astro:assets` exports `getImage`, `Image`, `Picture`, `Font`; `dist/types/public/config.d.ts:1458` declares `build.inlineStylesheets?: 'always' \| 'auto' \| 'never'`; sharp 0.35.5 is already the resolved image service dependency (2026-10-19). | Plan 4.5 stands: site images use `astro:assets` `Picture`; photo `<picture>` is built by our own helper from the snapshot variants. |
| 21 | Chrome on the build machine for `design-check` | Decides whether WP3-25 can run in the autopilot | Run `ls` on the Chrome app path or set `CHROME_PATH` | builder-offline | UNVERIFIED | The shell sandbox denied the check on 2026-10-19; availability unknown. | Tool will exit 2 "SKIPPED: Chrome not found" if absent; WP3-25 becomes HUMAN (about 10 minutes). |
| 22 | Pages treatment of `404.html` | Static 404 page and status | Preview deploy, request an unknown path | human | HUMAN | none | Pages serves a root `404.html` for unknown paths by documented convention (not verified here); the local server in WP3-24 imitates it. |
| 23 | Pages `_headers` detach syntax (`! Cache-Control`) used by `headers.ts` to remove a header from a broader rule (from T-67) | Wrong syntax could leave a long cache on HTML or be ignored | Read Cloudflare Pages headers docs, then `curl -I` on a preview for an HTML page and an asset | builder-with-WebSearch, then human | UNVERIFIED | none (no web access) | Treat the `!` detach lines as unproven until a preview shows the expected `Cache-Control` per path. |
| 24 | Lightbox touch gestures on real phones (WP3b-17): pinch, double-tap, one-finger pan, rubber-band behaviour | `npm run lightbox-a11y` drives Chrome with CDP touch events only; real iOS Safari and Android Chrome handle touch-action, double-tap and pointer capture differently (R7) | On an iPhone (Safari) and an Android phone (Chrome) open an album on a preview build, open a photo, then: pinch in and out, pan the zoomed photo, double-tap to zoom and double-tap to return, change photo and check it starts at fit, rotate the phone; confirm the page itself never zooms or scrolls behind the open photo and the buttons still work | human | HUMAN | none | If a gesture misbehaves on a device, the +/-/1x buttons remain the supported alternative (2.5.1, 2.5.7); fix the gesture code then. |

## WP-3 dependency pins (chosen 2026-10-19 with `npm view <pkg> version`; D-6 approved the list)

| Package | Pin | Dev or runtime | Used by |
|---------|-----|----------------|---------|
| sharp | 0.35.5 | apps/web devDependency (already installed transitively by astro) | WP3-6, WP3-21 |
| @fontsource/martel | 5.3.0 | apps/web dependency (font files copied to dist, no runtime code) | WP3-5 |
| lighthouse | 13.5.0 | root devDependency | WP3-24 |
| puppeteer-core | 25.14.0 | root devDependency | WP3-24 |
| axe-core | 4.14.0 | root devDependency | WP3-24 |
| aws4fetch | 1.0.20 | apps/api dependency | WP-4 |

Each is added by the step that first uses it, not before. No Tailwind (D-6).

## Row 16 detail

Node v22.23.1 (`.nvmrc`), npm 10.9.8.

| Package | Version | Where |
|---------|---------|-------|
| @electric-sql/pglite | 0.5.10 | root devDependencies |
| @vitejs/plugin-react | 6.1.2 | root and apps/admin devDependencies |
| jsdom | 30.1.3 | root and apps/admin devDependencies |
| tsx | 4.23.15 | root devDependencies |
| typescript | 7.0.2 | root devDependencies |
| vitest | 5.0.5 | root devDependencies |
| astro | 7.4.0 | apps/web dependencies |
| react | 18.3.1 | apps/admin dependencies |
| react-dom | 18.3.1 | apps/admin dependencies |
| @testing-library/dom | 10.4.2 | apps/admin devDependencies |
| @testing-library/react | 16.3.3 | apps/admin devDependencies |
| @types/react | 18.3.31 | apps/admin devDependencies |
| @types/react-dom | 18.3.7 | apps/admin devDependencies |
| vite | 8.3.4 | apps/admin devDependencies |
| @cloudflare/workers-types | 5.20261019.1 | apps/api devDependencies |
| wrangler | 4.151.2 | apps/api devDependencies |

`@mp/shared` has no dependencies.

`npm audit` (run once on 2026-10-19, no `npm audit fix`): `found 0 vulnerabilities`. Compared with the old CRA app's 104.

## Needs a human

| Row | One-line instruction | Minutes |
|-----|----------------------|---------|
| 2 | In the Cloudflare dashboard, create a Pages (or Workers assets) project from the preview build and add a deploy hook; confirm the Astro build runs. | 20 |
| 3 | In the Cloudflare dashboard, open Workers, Triggers, and confirm a cron trigger can be added on the free plan. | 3 |
| 4 | With a test R2 bucket, upload through a presigned PUT with a wrong Content-Length and note whether R2 rejects it. | 20 |
| 5 | In the Supabase dashboard (Authentication, MFA), check whether TOTP is enabled on the free plan. | 2 |
| 6 | In the R2 bucket settings, note the location and jurisdiction options and the one chosen. | 3 |
| 9 | Upload a real iPhone HEIC photo in Safari on the admin preview and report whether it decodes. | 10 |
| 10 | On a Phase 3 preview, open the browser network panel and cookies tab and confirm Web Analytics sets no cookie. | 5 |
| 13 | Publish the real catalog once and read CPU time and subrequest count in the Worker's live logs; read the current free-plan limits page (`docs/DEPLOY-API.md` section 9). | 10 |
| 24 | On an iPhone and an Android phone, test the album lightbox: pinch, double-tap, pan, change photo, rotate (full list in the row 24 above). | 10 |
| 11 | After 8 or more days of the daily keepalive, check the Supabase dashboard that the project was not paused. | 3 (plus waiting) |
