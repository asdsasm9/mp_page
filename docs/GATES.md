# Gates

`npm run gates` runs every check in the `CHECKS` registry of `scripts/gates.mjs` over the files git knows about (tracked plus untracked, ignored files excluded). `npm run gates -- --strict` also counts PENDING as failed; it must end with `GATES OK` and no PENDING row.

What the gates are, and are not:

- They are static text checks over source, configuration and docs. They catch drift (someone adds a service key, a second cron, a table nobody approved, an env variable nobody documented). They do not stop a determined bypass: a person who wants to hide a pattern from a regex can.
- The behavioural suites remain the real proof: the RLS tests on PGlite (`supabase/tests`), the quota-guard tests (`apps/api/test/quota-guard.test.ts`), the restore round trip, and `npm run admin-prod-check` on the production admin build. A green gate with a red suite is red.
- Gates that need a build (`no-ga-in-dist`, `analytics-in-dist`, `page-checks`, `budget`, the four `admin-dist-*`) report SKIP when no build is on disk. They never build anything themselves, so they stay fast.
- Golden means the rule reads its expected values from `scripts/architecture.golden.json` (the architecture file) or another committed golden file. Changing a golden file changes what the project promises; it needs an architect-approved decision, not a quiet edit to make a red gate green. Non-golden rules have their patterns in the gate code.

When a gate fails: read the one-line detail (it names the file or the item), fix the cause, rerun `npm run gates`. Do not loosen a pattern to get green.

## Rules

| Name | What it protects | How to fix a failure | Golden |
|------|------------------|----------------------|--------|
| `no-secrets` | No private key block, JWT, `sk_` key or long key-like value in any committed file outside `docs/` and `legacy/` | Remove the value, rotate the credential if it was real, read it from the environment instead | no |
| `no-service-role` | No Supabase service role reference in app code (SQL and docs may name it) | Use the anon key with the user's JWT; the Worker does privileged work through database functions | no |
| `no-env-files` | No `.env`, `.env.*` or `.dev.vars` file is committed (only `.env.example`) | Delete the file from git and add it to `.gitignore` | no |
| `env-example-sane` | `.env.example` holds names only, every value empty | Empty the value, keep the name | no |
| `env-example-complete` | `.env.example` lists exactly the variable names production code reads, each once, each with a comment line | Add or remove the name, or (rarely) add a documented docs-only exception in `ENV_DOCS_ONLY` | no |
| `no-legacy-ids` | The old Google Analytics and Tag Manager ids are gone from code | Remove the id; `docs/` and `legacy/` are exempt | no |
| `no-dead-deps` | No `react-scripts`, `react-ga4`, `gh-pages`, `react-router-dom` (the admin may use the router) in any manifest | Remove the dependency from `package.json` and the lockfile | no |
| `no-direct-r2` | R2 and S3 access (`aws4fetch`, the R2 endpoint, `R2Bucket`, the AWS SDK) only inside the two storage modules | Move the call into `packages/shared/src/storage` or `apps/api/src/storage` | no |
| `no-ga-in-dist` | Built html has no Google tag, analytics script or `gtag(` | Remove the script from the layout and rebuild | no |
| `analytics-in-dist` | The Cloudflare beacon appears only as one exact tag on the public site, never in the admin | Fix `Analytics.astro` or the layout so one tag with only a token is rendered; rebuild | no |
| `analytics-not-admin` | Admin and Worker sources never mention the analytics beacon | Remove the reference | no |
| `migrations-lint` | Migration file names, ascending timestamps, no `to public` grant, no always-true policy, no service role; the lint suite and its privilege matrix exist | Rename or fix the migration (never edit an applied one; add a new one) | partly (the privilege matrix file) |
| `page-checks` | Built pages: head tags, images, internal links that resolve, sitemap and canonical agreement, placeholder marker (an error only in a production build; needs `apps/web/dist`) | Fix the page or component named in the detail, rebuild; the controller-details placeholder warning on `/cookies/` is the open H-7 item | no |
| `budget` | Page weight and first-load limits per page (needs `apps/web/dist`) | Shrink the named resource or fix the limit only with a recorded decision | no |
| `quota-guard-tests` | The fixed quota-guard test cases still exist by title | Restore the deleted or renamed case in `apps/api/test/quota-guard.test.ts` | no |
| `api-hygiene` | `wrangler.toml` has no `[vars]`, secret-named assignment or key-shaped value; Worker logs never mention authorization | Move values to Worker secrets; remove the log line | no |
| `admin-no-service-key` | Admin source never mentions a service key | Remove it; the admin only has the anon key and the user's JWT | no |
| `admin-no-signup` | Admin source has no sign-up or user-creation call | Remove it; users are created by hand in the Supabase dashboard | no |
| `admin-no-html-inject` | No `innerHTML`, `dangerouslySetInnerHTML`, `eval` or `document.write` in admin source | Render text through React instead | no |
| `admin-no-photo-writes` | Admin never inserts or deletes `photos` rows directly | Go through the Worker (`/uploads/commit`, `/photos/delete`) | no |
| `admin-no-r2-hosts` | Admin source has no R2 host or SDK (uploads use presigned URLs) | Ask the Worker for a presigned URL | no |
| `admin-no-limit-literals` | The storage and upload limits are not hard-coded in the admin | Read them from `app_config` | no |
| `admin-dist-no-fake` | The production admin build does not contain the fake-world marker | Rebuild without the fake backend; check `VITE_BACKEND` | no |
| `admin-dist-no-keys` | The production admin build contains no JWT, secret-looking value, `service_role` or private key | Find the string in the bundle source and remove it | no |
| `admin-dist-no-analytics` | The production admin build has no analytics beacon | Remove the beacon from the admin | no |
| `admin-dist-hosts` | The admin bundle talks only to library hosts and hosts from the build variables | Remove the stray URL or set the intended variable | no |
| `migrate-no-service-key` | The legacy migration script never uses a service key | Use the photographer's own sign-in | no |
| `migrate-no-signup` | The migration script never creates users | Remove the call | no |
| `migrate-no-photo-writes` | The migration script never writes `photos` directly (the Worker commit does) | Use the Worker commit path | no |
| `migrate-no-r2` | The migration script has no R2 or S3 host or SDK | Use presigned URLs from the Worker | no |
| `migrate-no-credentials` | No credential-shaped string in the migration script | Read credentials from the environment at run time | no |
| `backup-no-service-key` | Backup and restore-plan scripts never use a service key | Use the admin's own token | no |
| `backup-no-r2` | Backup and restore-plan scripts have no R2 or S3 host or SDK | Fetch public masters over https from the image host | no |
| `backup-read-only` | No write method literal in backup or restore-plan except the one sign-in request | Remove the write; these tools only read | no |
| `backup-no-credentials` | No credential-shaped string in backup or restore-plan scripts | Read credentials from the environment at run time | no |
| `restore-plan-offline` | `restore-plan` sources make no network call and spawn no process (raw scan, comments included) | Remove the call, or reword a comment that contains a banned word | no |
| `arch-components` | Workspaces, required dependencies, static Astro output with no server adapter, pinned `astro` | Restore the workspace or dependency; a real change needs an architect decision and a golden update | yes (`components`) |
| `arch-data-model` | The ten approved tables, RLS and initial revoke on each, no anon grants, `app_config` defaults, required functions | Fix the migration (add a new one); a new table needs an architect decision | yes (`dataModel`) |
| `arch-api-surface` | The seven Worker routes, bindings, one cron, no `[vars]`, the three secrets, a heading per route in `docs/API.md` | Restore the route or binding, or document it in `docs/API.md`; a new route needs a decision | yes (`api`) |
| `arch-storage-keys` | Storage key templates and image tiers match the MASTERPLAN | Revert the template change; changing a key breaks published URLs | yes (`storageKeys`) |
| `arch-hosting-files` | Web generates `_headers`, `_redirects`, `_publish.json`; admin has CSP headers, SPA fallback, `noindex`; no GitHub Pages or Google tag references | Restore the generator or header; remove the reference | yes (`hosting`) |
| `arch-tests-present` | The MASTERPLAN test suites still exist (by file glob) | Restore the deleted suite | yes (`requiredSuites`) |
| `docs-complete` | Required docs exist, README sections, every relative link and anchor resolves, no placeholder text in the new docs, every `npm run` name exists, one row here per rule, no key-shaped string in the new docs | Create or repair the doc named in the detail; add a row here for a new rule | no |

Adding a gate: put the function in `scripts/gates.mjs` (or `scripts/gates-arch.mjs` for architecture rules), register it in `CHECKS`, add synthetic pass and fail tests in `scripts/gates.test.mjs`, and add its row above. `docs-complete` fails until the row exists.

The WP-8 verification record is [WP8-VERIFICATION.md](WP8-VERIFICATION.md).
