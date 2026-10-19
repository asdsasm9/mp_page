# Verification notes (TO VERIFY items)

Written 2026-10-19 by a builder with no web access. Statuses: VERIFIED (evidence required), UNVERIFIED, HUMAN, FAILED.
Rule: a forum post alone is never VERIFIED; prefer vendor docs and note the date read. Nothing below was read from the web.

| # | Item | Why it matters | How to verify | Who | Status | Evidence (date) | Consequence for the plan |
|---|------|----------------|---------------|-----|--------|-----------------|--------------------------|
| 1 | PGlite RLS | Migrations and RLS must be testable offline | Run `npm test`, see `supabase/tests/pglite-capability.test.ts` | builder-offline | VERIFIED | `supabase/tests/pglite-capability.test.ts`, 9 tests pass (2026-10-19). SET ROLE, RLS policy hiding rows, column grants, security definer with `set search_path=''`, `revoke execute from public`, and `auth.uid()` from the claim all work. | WP-2 tests run on PGlite. Migrations must `revoke ... from public, anon` explicitly, because the stub (like Supabase) grants permissively by default. |
| 2 | Pages vs Workers static assets; deploy-hook support for Astro | Decides the hosting target and how publish triggers a build | Read current Cloudflare docs (Pages, Workers static assets, deploy hooks); confirm in a real WP-8 or Phase 3 preview | builder-with-WebSearch, then human | UNVERIFIED | none (no web access) | Hosting choice stays provisional; publish flow must not depend on a deploy hook until confirmed. |
| 3 | Cron triggers on the Workers free plan | Keepalive and backup jobs depend on them | Read Workers pricing/limits docs; confirm in the dashboard at deploy | builder-with-WebSearch, then human | UNVERIFIED | none | If unavailable, use an external scheduler or a manual trigger. |
| 4 | R2 presigned PUT enforcing content-length | Upload size limits and quota | Local signing can be checked offline in WP-4; enforcement needs a live bucket test | human (Phase 3 live step) | HUMAN | none | HEAD at commit, DB backstop and reconcile stay mandatory regardless. |
| 5 | Supabase TOTP/MFA on the free plan | Admin login hardening | Read Supabase docs; Adam confirms in the dashboard | human | HUMAN | none | If not on free, fall back to a strong password plus single admin allowlist. |
| 6 | R2 data location and jurisdiction | GDPR statements | Read R2 docs; Adam checks the bucket settings | human | HUMAN | none | Do not claim EU-only anywhere until confirmed. |
| 7 | Pages build limits (builds per month, time) | Publish frequency | Read Cloudflare Pages limits docs | builder-with-WebSearch | UNVERIFIED | none | Publish may need debouncing. |
| 8 | r2.dev rate limits | Previews without a custom domain | Read R2 public bucket docs | builder-with-WebSearch | UNVERIFIED | none | Matters only if no custom domain is ready for previews. |
| 9 | HEIC decode in the browser (library, licence, size; real iPhone/Safari behaviour) | Photo upload from phones | Docs and library lookup; test with a real HEIC photo on iPhone and Safari | builder-with-WebSearch, then human | HUMAN | none | Upload flow may need server-side or camera-JPEG fallback. |
| 10 | Cloudflare Web Analytics cookieless claim and default behaviour | Consent banner decision | Read docs; check browser network panel and cookies on a Phase 3 preview | builder-with-WebSearch, then human | HUMAN | none | See docs/ANALYTICS-CONSENT.md; keep analytics off until confirmed. |
| 11 | Supabase free-project pause policy (inactivity period; whether a PostgREST RPC counts) | Site data could disappear behind a paused project | Read Supabase docs; observe the daily keepalive for at least 8 days | human | HUMAN | none | Keepalive design is provisional. |
| 12 | Current prices and free-tier numbers (R2 10 GB and operations, Supabase Free, Workers 100k requests/day, Pages) | Quota guard constants and cost claims | Read each vendor pricing page, record with date | builder-with-WebSearch | UNVERIFIED | none | Quota numbers in WP-2/WP-4 are placeholders until recorded. |
| 13 | Workers free-plan limits for WP-4 (subrequests per request, CPU time, body size, whether publish fits one request) | Batch reserve must be one RPC; publish job design | Read Workers limits docs | builder-with-WebSearch | UNVERIFIED | none | Assume the strictest case: one RPC per batch, publish split into steps. |
| 14 | R2 "GB" decimal or binary | Margin of the 9.5e9 hard limit | Read R2 pricing docs | builder-with-WebSearch | UNVERIFIED | none | 9.5e9 keeps margin under either reading of 10 GB (10e9 decimal, about 10.74e9 binary). |
| 15 | Local offline build (web and admin); optional `wrangler deploy --dry-run` | Skeleton must build without services | `npm run build` | builder-offline | UNVERIFIED | `npm run build` exited 0 on 2026-10-19 and produced `apps/web/dist/index.html` and `apps/admin/dist/index.html`. The sandbox had network access, so "works with no network" is not proven. `wrangler deploy --dry-run` was not run (it may ask for login). | Re-run with the network off to close this row. |
| 16 | Exact dependency versions, Node, npm audit | Reproducible installs | See below | builder-offline | VERIFIED | `package.json` files read 2026-10-19; `npm audit` run once | All pinned exactly; lockfile committed. |

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
| 11 | After 8 or more days of the daily keepalive, check the Supabase dashboard that the project was not paused. | 3 (plus waiting) |
