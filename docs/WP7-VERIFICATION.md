# WP-7 final verification (T-170, step WP7-8)

Date: 2026-10-20. Branch `autopilot`, working tree clean before this file was added. Everything below ran offline and token-less. No Cloudflare dashboard, no real beacon token, no production deploy and no browser against a beacon build were involved, and no live result is claimed. Commands ran one after another, never in parallel, builds never concurrent with `npm test`.

## Commands run

| Command | Result |
|---------|--------|
| `npm test` | exit 0. 131 test files, 2394 tests passed, 5 skipped, 124.4 s. jsdom prints "Not implemented: HTMLCanvasElement getContext" 24 times (admin encoder tests, known since WP-5). |
| `npm run typecheck` | exit 0 for admin, api (src and test tsconfig), web, shared and `scripts/tsconfig.json`. |
| `npm run gates` | exit 0, "GATES OK". New rules PASS: `no-ga-in-dist` (23 html files clean), `analytics-in-dist` (23 html files, beacon only as the exact tag on the public site), `analytics-not-admin` (146 admin and api sources clean), `admin-dist-no-analytics` (8 built files clean). `budget` 21 pages within budget. PENDING: `docs-complete` (WP-8), the only one. `page-checks` repeats the known `[doplnit]` warning on `/cookies/` (cutover blocker H-7, not WP-7). |
| `npm run build -w apps/web` (token-less) | exit 0, 22 pages, postbuild line "postbuild: _redirects, _headers, _publish.json written (local, fixture)." The analytics output check ran inside postbuild (token null) and found nothing. |
| `npm run design-check` | exit 0, `DESIGN_CHECK: PASS`. All 7 pages axe=0, console=0, overflow320=0px. Lighthouse a11y/bp/seo = 1 on the five measured pages, perf 0.98 to 1, CLS 0.000, TBT 0 ms, LCP 1.65 to 2.48 s (`/` 2404, `/svatby/` 2478, `/svatby/sedlakovi/` 1729, `/o-mne/` 2403, `/kontakt/` 1653). Screenshots were not opened in this run (this task is verification only; no UI changed). |
| `git status --short` | empty before this file was written. |

## With-token path, offline (throwaway script, not committed)

Script: `/private/tmp/claude-501/-Users-adamkollar-Documents--Projekty-autopilot-work-mullnyphotos/e95fd5ba-aacf-470f-8583-075ce5878d1d/scratchpad/with-token.mts` (run with `npx tsx`). It copies `apps/web/dist` into the scratchpad, injects into every html page the tag in the form Astro renders it (`type="module"`, `src` the beacon, entity-escaped `data-cf-beacon="{&quot;token&quot;:&quot;...&quot;}"`, fake 20-char token `abcdef0123456789ABCD`), adds `COOKIES.ANALYTICS_PARAGRAPH` to `/cookies/`, patches `_headers` with `https://static.cloudflareinsights.com` in `script-src` and `https://cloudflareinsights.com` in `connect-src`, then runs `checkAnalyticsOutput` (`apps/web/src/lib/postbuild.ts`) and `checkAnalyticsInDist` and `checkNoGaInDist` (`scripts/gates.mjs`).

| Case | checkAnalyticsOutput errors | analytics-in-dist | no-ga-in-dist |
|------|------|------|------|
| Green copy, 22 pages | 0 | PASS | PASS |
| `connect-src` host removed | 1 (CSP connect-src lacks cloudflareinsights.com) | PASS | PASS |
| Tag removed from one page | 1 (expected exactly one beacon tag, found 0) | PASS | PASS |
| Two tags on one page | 1 (found 2) | FAIL | PASS |
| Paragraph removed from `/cookies/` | 1 (privacy page lacks the paragraph) | PASS | PASS |
| Inline `gtag("x")` added | 2 | PASS | FAIL |
| `defer` instead of `type="module"` | 0 (postbuild only checks src and token) | FAIL | PASS |

Green when complete, red when any single piece is removed or altered, by at least one of the two layers. Note the last row: the postbuild check does not pin `type="module"`; the gate does, and the component render test pins it at the source.

## Acceptance table

| Step | Criterion | Evidence | Status |
|------|-----------|----------|--------|
| WP7-1 | VERIFY row 10 has source and per-question result | `docs/VERIFY.md` row 10: six answers with URLs and quotes; token format "not confirmed", Pages auto-disable "not confirmed", both with fallbacks | Done (docs only; browser check HUMAN) |
| WP7-2 | Env and CSP | `env.test.ts`, `headers.test.ts` (flag absent keeps the CSP byte-identical, true adds exactly the two hosts); `.env.example` names the variable only; postbuild passes `analytics: env.analyticsToken !== null` | Verified (unit) |
| WP7-3 | Beacon component | `Analytics.render.test.ts` (real Astro container: nothing without token; exactly one module script with parseable config, no `defer`); token-less `Base.test.ts` passes | Verified (render) |
| WP7-4 | Postbuild verification | `postbuild-analytics.test.ts` incl. negatives; token-less build above prints the postbuild line; synthetic dist with two tags gives a non-empty error list (table above) | Verified (synthetic) |
| WP7-5 | Gates and budget | `gates.test.mjs`, `site-budget.test.mjs`, `admin-prod-check.test.mjs`; `npm run gates` green with the four new rules; googletagmanager and admin-beacon failures covered by those tests | Verified |
| WP7-6 | Privacy page | `AnalyticsSection.render.test.ts` (both flags), `Base.test.ts` cookies test updated, `docs/TEXTS-REVIEW.md` lists the paragraph "to approve"; three controller `[doplnit]` lines remain (gate warning above) | Verified (render); wording needs approval |
| WP7-7 | Documentation | `docs/WEB.md` Analytics section, `docs/ANALYTICS-CONSENT.md` status note, `docs/SEO.md`, README link; guarded by `scripts/analytics-docs.test.ts` | Done |
| WP7-8 | Final verification | this file; all commands exit 0; design-check console=0 everywhere; VERIFY row 10 already reads "automated parts done, human browser check pending" | Done |

## Only offline

- The real with-token production build was never made (production needs an https snapshot). The with-token path is proven by pure functions, the component render test and the synthetic dist above, which hand-writes the tag instead of rendering the whole site with a token. The first real deploy is the first true test; postbuild fails that deploy if tag, CSP or paragraph is wrong.
- Cookieless and no-storage behaviour of the real beacon is a vendor claim from the docs, not observed. The static scan only covers our own JS and html.
- The real token format is unknown; the pattern `^[A-Za-z0-9]{16,64}$` is a guess. The fake token used here has 20 characters.
- Beacon size (about 5 to 6 KB gzip in the plan) was not measured; it is not counted by `measureFirstLoad`.
- The design-check ran token-less, so it did not see the beacon or the analytics paragraph.

## Deviations from the plan

1. The tag is `type="module"`, not `defer` (the docs show the module form; `defer` is not documented). Plan 4.1 and section 6 were annotated; pinned in `Analytics.render.test.ts` and `isExactBeaconTag` in `scripts/gates.mjs`.
2. Render tests run in an extra vitest project `web-render` (root `vitest.config.ts`) because the Astro container API needs the Astro vite plugin.
3. `Analytics.astro` takes a `token` prop passed from `Base.astro`, instead of reading the env itself.
4. The Pages auto-setup toggle is undocumented: how to disable it per project and how it interacts with a manual snippet could not be confirmed. Fallback: keep it off on both Pages projects and check view-source for one tag.
5. The cookies section is its own component `AnalyticsSection.astro` (T-168).

## Findings (not fixed)

1. `checkAnalyticsOutput` accepts a `defer` tag without `type="module"` (only the gate rejects it). Harmless since the component pins the form, but the two layers differ.
2. The token-less postbuild output line does not mention the analytics check; a one-word addition would make the check visible in build logs.

## Left to a human (nothing below was run)

1. Cloudflare dashboard: create the Web Analytics site for `www.mullnyphotos.cz` with the manual snippet, copy the token. Keep the Pages "Web Analytics / automatic setup" toggle OFF on the `web` and `admin` Pages projects.
2. Pages `web` project, Production environment only: set `PUBLIC_CF_ANALYTICS_TOKEN`, not for Preview. Redeploy.
3. After the first production deploy, the browser check (VERIFY row 10, and the checklist row 10 of the pre-launch list): view-source shows exactly one beacon tag; the network panel shows only the two Cloudflare hosts; the Application tab shows no cookies and empty local and session storage after three pages; the dashboard shows the visit. If a cookie or storage entry appears: remove the variable, redeploy and tell the architect (option C premise broken).
4. The photographer approves the Czech analytics paragraph and supplies the controller details (H-7) that replace the `[doplnit]` lines.
5. Optional: read the dashboard monthly.

## Verdict

PASS for offline verification of WP-7: all five commands exited 0, the synthetic with-token dist is green and every single-piece removal turns it red. The with-token production build and the real beacon behaviour are UNVERIFIED until the first deploy and the human browser check.
