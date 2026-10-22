# WP-8 final verification (T-198, step WP8-18)

Date: 2026-10-21. Branch `autopilot`. Everything below ran offline against fakes and PGlite. Nothing was run live: no Supabase project, no R2 bucket, no Cloudflare dashboard, no live masters backup (that tool was removed later by T-222), no restore, no deploy. Commands ran one after another, `npm test` alone with nothing else running.

## Commands run

| Command | Result |
|---------|--------|
| `npx vitest run scripts` | exit 0. 43 test files, 798 tests passed, 5 skipped. |
| `npm run gates -- --strict` | exit 0, ends `GATES OK`, 43 rows, none PENDING. `docs-complete` PASS: "12 required docs, links, scripts and 43 gate rows ok". `env-example-complete` PASS (30 names). `page-checks` still prints the known controller-details placeholder warning on `/cookies/` (open H-7, not WP-8). |
| `npm run typecheck` | exit 0 for admin, api (src and test tsconfig), web, shared and `scripts/tsconfig.json`. |
| `npm test` (alone) | exit 0. 149 test files, 2780 tests passed, 5 skipped, 95.3 s. jsdom prints "Not implemented: HTMLCanvasElement getContext" 24 times (admin encoder tests, known since WP-5). |

Test count against the baseline: 2398 in the plan, now 2780 passed (+382 over the whole of WP-8: env scanner, architecture, backup and restore, docs tests). This task added `scripts/gates-docs.test.mjs` (43 tests: synthetic pass, one fail per rule, link and Czech anchor helpers, GATES.md rows equal `CHECKS`, real-repo green) and rewrote three registry tests in `scripts/gates.test.mjs`.

## What changed in T-198

- `scripts/gates-docs.mjs`: `checkDocsComplete(files, checkNames)` and `checkGatesRows(files, checkNames)`. `docs-complete` in `scripts/gates.mjs` now passes `CHECKS.map(c => c.name)` lazily, so there is no import cycle. The key-shape patterns moved to `SECRET_PATTERNS` in `scripts/lib/gate-utils.mjs` and are shared with `no-secrets`.
- Rules: 12 required files; README headings Run, Test, Deploy, Cutover, Maintenance and the text H-5; every relative link in README and `docs/*.md` resolves, and every `#anchor` matches a heading (GitHub slug, Czech diacritics kept, repeated headings numbered, code fences ignored); no placeholder words in README, NAVOD, MAINTENANCE, BACKUP, GATES; every named `npm run` command (not the workspace `-w` forms) is a root script; `docs/GATES.md` has exactly one row per `CHECKS` entry; no key-shaped string in the same five docs.
- `docs/GATES.md` written (43 rows).
- Existing docs with a real defect, fixed with small edits instead of weakening the gate. The links were all fine; the `npm run` rule found three stale commands: `docs/ANALYTICS-CONSENT.md` named a `test:e2e` script (no such script, Playwright was never added) and `docs/AUDIT.md` named the old `deploy` script three times (the old CRA script that exists only on the legacy `main` branch). Both now say so in words without the command form.
- README: one line under Test links `docs/GATES.md` and this file.

## Three deliberate breakages (real repo files in memory, throwaway script in the scratchpad)

Script: `/private/tmp/claude-501/-Users-adamkollar-Documents--Projekty-autopilot-work-mullnyphotos/0a6a5279-e8dd-4620-9441-352ccbb9da98/scratchpad/breakages.mjs` (not committed). It loads the real repo with `loadFiles(gitPaths)`, changes the in-memory copy and runs the gate. The same cases are covered permanently by `scripts/gates-docs.test.mjs` (missing file, dead link) and `scripts/gates.test.mjs` (`env-example-complete`).

| Breakage | Gate | Result |
|----------|------|--------|
| none (baseline) | `docs-complete`, `env-example-complete` | PASS, PASS |
| `docs/BACKUP.md` deleted | `docs-complete` | FAIL: "docs/BACKUP.md missing; README.md:92 dead link docs/BACKUP.md; docs/MAINTENANCE.md:10 dead link ...; and 1 more" |
| file restored | `docs-complete` | PASS |
| `See [gone](docs/NOT-THERE.md).` appended to `docs/WEB.md` | `docs-complete` | FAIL: "docs/WEB.md:174 dead link docs/NOT-THERE.md" |
| line removed | `docs-complete` | PASS |
| `import.meta.env.PUBLIC_NEW_UNDECLARED_FLAG` added to `apps/web/src/lib/env.ts` | `env-example-complete` | FAIL: "PUBLIC_NEW_UNDECLARED_FLAG is read (apps/web/src/lib/env.ts) but missing from .env.example" |
| line removed | `env-example-complete` | PASS |

Each gate went red on the synthetic change and green again once it was undone. No repo file was modified by the script.

## Acceptance table

| Criterion | Evidence | Status |
|-----------|----------|--------|
| `npm run gates -- --strict` ends GATES OK, no PENDING | output above | Done |
| `npm test` and typecheck green | above | Done |
| Fail test per `docs-complete` rule | `scripts/gates-docs.test.mjs`: missing file (each of 12), dead link, dead anchor, placeholder (each of 5 words, each new doc), unknown npm script, GATES.md row missing or extra, each missing README heading, no H-5, secret-shaped string | Done |
| GATES.md rows equal `CHECKS` | real-repo test in `gates-docs.test.mjs` | Done |
| Czech diacritics in anchors | slug unit test; plain and percent-encoded anchor resolve, ASCII-folded anchor does not | Done |

## Left to a human (nothing below was run)

1. H-5: DNS to Cloudflare, with the care list in the README cutover.
2. H-6: work through the "Needs a human" rows in [VERIFY.md](VERIFY.md).
3. H-7: the photographer gives the controller details for `/cookies/`; the `page-checks` warning disappears.
4. H-8: real-phone lightbox check after the production publish.
5. H-10: the live legacy migration.
6. H-11: the Cloudflare analytics token.
7. H-12: the photographer reads [NAVOD.md](NAVOD.md) and confirms the Czech wording and the 10-step checklist.
8. (Dropped by T-222 and D-17: VERIFY row 37 and the restore tool were removed together with all backups, so there is nothing to check. See [BACKUP.md](BACKUP.md).)
9. (Dropped by T-222: the masters backup tool and the backup bucket were removed at the owner's request, so there is nothing to run here.)

## Known unproven (0 EUR and no-care claims)

These VERIFY rows are not proven. Until a human runs the check, the "0 EUR per month" and "needs no care" claims are assumptions.

| VERIFY row | Unproven fact | Claim it affects | Check a human runs |
|------------|---------------|------------------|--------------------|
| 3 | Cron triggers work on the Workers free plan | Daily keepalive and backup run by themselves | Cloudflare dashboard, Workers, Triggers: add the cron; see [DEPLOY-API.md](DEPLOY-API.md) sections 3, 8, 9 |
| 11 | Supabase free-project pause policy, and whether the keepalive counts as activity | Site data does not vanish behind a paused project | After 8 or more days of keepalive, check the Supabase dashboard that the project is not paused |
| 12 | Current free-tier numbers (R2, Supabase, Workers, Pages) | The 0 EUR cap and the quota guard constants | Read each vendor pricing page and record the figures with the date in VERIFY.md |
| 13 | Workers free-plan CPU and subrequest limits for publish | Publish works without a paid plan (about 5 USD per month) | Publish the real catalog once and read CPU time and subrequests in the live logs ([DEPLOY-API.md](DEPLOY-API.md) section 9 step 8) |
| 14 | R2 "GB" decimal or binary | Storage stays under the free 10 GB | Read the R2 pricing docs (the 9.5e9 limit keeps margin either way) |
| 17 | Pages `_redirects` limits and 410 support | Old links keep working; deleted albums answer correctly | Read the Pages redirects docs, then test about 10 old URLs on a preview |

## Only offline, honest notes

- The gates are static text checks. They catch drift, not a determined bypass; see [GATES.md](GATES.md). The RLS, quota-guard and restore round-trip suites are the behavioural proof.
- Backup and restore have never touched a live service. The assumption that masters are publicly readable under the image host is unverified.
- The Czech wording in NAVOD.md is unreviewed by the photographer (H-12). Only the quoted labels are tested against the admin messages.
- Platform facts marked TO VERIFY in [MAINTENANCE.md](MAINTENANCE.md) stay unconfirmed until checked by a human.
- The MASTERPLAN still mentions Tailwind for the UI, while the repo uses plain CSS with design tokens and no Tailwind (decision D-6, [DESIGN-TOKENS.md](DESIGN-TOKENS.md)). This is a wording discrepancy in the plan, not a code problem; no gate looks at it.
- `docs-complete` checks that links and anchors exist and that scripts exist. It does not judge whether the text is correct or complete.
- Next step: full gate review (architect), as set in the plan.
