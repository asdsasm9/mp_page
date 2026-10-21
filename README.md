# Mullny Photos

Monorepo for the new mullnyphotos.cz: a static public site, a photographer's admin, a small API Worker and shared contracts. Everything is built and tested offline against fakes. Nothing is deployed yet and no live service has been touched; the cutover below is a list of human steps.

The old CRA site lives on the `main` branch and the git tag `legacy-cra` (a hotfix to it means checking out that tag). Old photos are kept in `legacy/`.

## Architecture

```
Visitors     -> Cloudflare CDN -> www   (Pages project "web", Astro static, Czech)
                               -> img   (R2 bucket: photo variants and catalog/published.json)
Photographer -> admin (Pages project "admin", Vite + React SPA)
                 |-> Supabase: Auth + Postgres under RLS (catalog CRUD with the user's JWT)
                 |-> Worker "api": quota, upload reservation, delete, publish, daily keepalive
                 |-> R2 presigned PUT (URL signed by the Worker)
Publish: the Worker writes the snapshot and a backup, calls the Pages deploy hook; web rebuilds from the snapshot.
```

Contracts live in `packages/shared` (snapshot schema, storage keys, quota math). The full plan is the MASTERPLAN in the autopilot project folder.

## Requirements

- Node as pinned in `.nvmrc` (22.23.1); `package.json` `engines.node` requires `>=22.23.1`.
- Chrome, only for the optional browser checks (found automatically on macOS).

## Run

- `npm install`
- `npm run dev-images` generates local dev photos once (fixture mode needs them).
- `npm run dev -w apps/web` starts the public site on fixtures (noindex, no network).
- `npm run dev -w apps/admin` starts the admin; with `VITE_BACKEND` unset it needs the real service URLs, see [Environment](#environment) and [docs/ADMIN.md](docs/ADMIN.md#fake-mode) for the in-memory mode.
- `npm run build` builds web and admin. `npm run check:site` builds web and runs the page and budget checks.

Web build modes and commands: [docs/WEB.md](docs/WEB.md#build-modes).

## Test

- `npm test` runs every Vitest project once, offline.
- `npm run typecheck` runs `tsc` in every workspace and in `scripts`.
- `npm run gates` runs the repository gate checks (`-- --strict` also fails on pending ones).
- Optional browser checks need Chrome and a built app. Run them one at a time, never during `npm test`, never two at once (concurrent Astro builds collide):
  `npm run design-check`, `npm run image-fit`, `npm run lightbox-network`, `npm run lightbox-a11y` (web, need `dist` and dev images), and `npm run admin-check`, `npm run admin-encode-check`, `npm run admin-prod-check` (admin).
- Never put environment variables in front of a command; the checks find Chrome themselves.

What each check proves: [docs/WEB.md](docs/WEB.md#browser-checks-need-chrome-a-built-appswebdist-and-dev-images), [docs/ADMIN.md](docs/ADMIN.md#check-commands), [docs/DESIGN-CHECK.md](docs/DESIGN-CHECK.md).

## Deploy

Four parts, each with its own human steps. Do them in this order; the steps live only in the linked docs.

| Part | Where the steps are |
|------|---------------------|
| Supabase migrations | `supabase db push` from the repo root on the linked project (migrations live in `supabase/migrations`), then users and `admins` rows: [docs/ADMIN.md](docs/ADMIN.md#deploying-the-admin-human-steps) step 5; schema: [docs/DATA-MODEL.md](docs/DATA-MODEL.md) |
| api (Worker) | [docs/DEPLOY-API.md](docs/DEPLOY-API.md#8-deploy); routes: [docs/API.md](docs/API.md) |
| admin (Pages) | [docs/ADMIN.md](docs/ADMIN.md#deploying-the-admin-human-steps) |
| web (Pages) | [docs/WEB.md](docs/WEB.md#cutover-checklist-web-part); publish flow: [docs/WEB.md](docs/WEB.md#publish-to-deploy) |

Unconfirmed platform facts are collected in [docs/VERIFY.md](docs/VERIFY.md).

## Cutover

Go-live checklist for the old GitHub Pages site. Human steps only; H-numbers are the human to-dos tracked in the autopilot STATE. Avoid wedding-busy weeks.

1. H-2 finished: Cloudflare account, R2 buckets (public and private backup), CORS, bucket-scoped token, Worker secrets. See [docs/DEPLOY-API.md](docs/DEPLOY-API.md#0-prerequisites).
2. Supabase set up: migrations pushed, sign-ups off, two users, `admins` rows, auth redirect URLs. See [docs/ADMIN.md](docs/ADMIN.md#deploying-the-admin-human-steps).
3. H-6 done: the "Needs a human" items in [docs/VERIFY.md](docs/VERIFY.md) are worked through and the results recorded there.
4. H-7: the photographer gives the controller details for `/cookies/`; replace the placeholder lines. See [docs/WEB.md](docs/WEB.md#analytics).
5. H-11: the Cloudflare analytics token is created and set. See [docs/WEB.md](docs/WEB.md#analytics).
6. Deploy Worker, admin and web to preview URLs (Deploy table above). Keep the old site primary.
7. H-10: run the live legacy migration (first one album, then all). See [docs/MIGRATION.md](docs/MIGRATION.md#steps).
8. Publish once from the admin as a preview (using the preview image URL or an `r2.dev` URL, since `img` does not exist yet), then check the preview site.
9. Phase 3 preview review: the photographer checks the design and works through [docs/NAVOD.md](docs/NAVOD.md) on a test album. Fix findings before DNS.
10. H-5, part 1: export or screenshot the old DNS zone first. Then move DNS to Cloudflare and compare record by record: A/AAAA, `www` CNAME, MX and TXT, so mail keeps working. Evidence: mail and the old site still work.
11. Connect the `img`, `api` and `admin` hostnames; check each answers over https.
12. Attach `www` (and the apex redirect, HSTS) to the web project: H-5, part 2.
13. Set the production web variables (`PUBLIC_SITE_ENV`, `PUBLIC_SNAPSHOT_URL`, `PUBLIC_IMG_BASE_URL`; see `.env.example` class 1) and run the first production publish, only after `img` works (the site build fetches the snapshot and photos from it). Then do the real-phone lightbox check (H-8) and run the Rich Results and Schema.org validators (see [docs/WEB.md](docs/WEB.md#cutover-checklist-web-part)).
14. Check about 10 old URLs against the redirect list: [docs/WEB.md](docs/WEB.md#cutover-checklist-web-part) step 4, rules in [docs/CONTENT-MAPPING.md](docs/CONTENT-MAPPING.md#73-real-path-redirects-server-side-cloudflare); switch redirects on only after H-5 ([docs/MIGRATION.md](docs/MIGRATION.md#the-redirect-file)).
15. Submit `sitemap.xml` in Google Search Console.
16. Test the github.io redirect; fallback in [docs/CONTENT-MAPPING.md](docs/CONTENT-MAPPING.md#74-other-legacy-host).
17. Delete the old Google Tag Manager container.
18. Legacy removal (`legacy/fotky_web`, stale `build/`) only after the photographer and Adam confirm in writing; the tag `legacy-cra` keeps history.

Rollback at any point: point DNS back to GitHub Pages and delete nothing. Keep the `gh-pages` branch for at least 4 weeks. Migration rollback: [docs/MIGRATION.md](docs/MIGRATION.md#rollback).

## Environment

Copy `.env.example` for local settings; never commit real values. The file lists names only, grouped by who sets them: web build, admin build, Worker plain vars, Worker secrets, migrate and backup scripts, optional check tooling. The gate `env-example-complete` keeps it equal to the names the production code reads. Per-part tables: [docs/WEB.md](docs/WEB.md#build-modes), [docs/ADMIN.md](docs/ADMIN.md#environment-variables), [docs/DEPLOY-API.md](docs/DEPLOY-API.md#5-secrets-and-configuration). With no web variables set, the web build runs in fixture mode.

## Backups

The Worker keeps the newest 20 catalog backups on every publish. For a local copy of catalog and masters, and for recovery, see [docs/BACKUP.md](docs/BACKUP.md) (`npm run backup`, `npm run restore-plan`; neither has been run live).

## Maintenance

What can need attention, who does it and when: [docs/MAINTENANCE.md](docs/MAINTENANCE.md), including the [quarterly checklist](docs/MAINTENANCE.md#quarterly-checklist-about-20-minutes). The photographer's Czech how-to is [docs/NAVOD.md](docs/NAVOD.md).

## Repo layout

| Path | What |
|------|------|
| `apps/web` | Astro static public site (lang `cs`) |
| `apps/admin` | Vite + React 18 admin |
| `apps/api` | Cloudflare Worker API (not deployed yet) |
| `packages/shared` | `@mp/shared` contracts, consumed as TypeScript source |
| `supabase` | Migrations, seed and PGlite tests |
| `scripts` | Gates, browser checks, migration, backup and restore tooling |
| `docs` | Specs, human steps, verification records, [VERIFY.md](docs/VERIFY.md) |
| `legacy` | Old site photos, kept until removal is confirmed |
