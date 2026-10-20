# Mullny Photos

Monorepo for the new mullnyphotos.cz: a static Astro public site, a React admin, a Cloudflare Worker API and shared contracts. The public site (WP-3 and WP-3b), the API Worker (WP-4) and the admin (WP-5) are built; nothing is deployed from the repo.

The old CRA site lives on the `main` branch and the git tag `legacy-cra` (a hotfix to it means checking out that tag). Old photos are kept in `legacy/`.

## Workspaces

| Path | What |
|------|------|
| `apps/web` | Astro static public site (lang `cs`) |
| `apps/admin` | Vite + React 18 admin |
| `apps/api` | Cloudflare Worker API, never deployed from here |
| `packages/shared` | `@mp/shared` contracts, consumed as TypeScript source |
| `supabase/tests` | PGlite helpers and capability tests |
| `scripts` | `gates.mjs` and image audit |
| `docs` | Audit, specs, `VERIFY.md` |

## Commands

- `npm install`
- `npm test` runs all Vitest projects once.
- `npm run typecheck`
- `npm run build` builds web and admin.
- `npm run gates` runs the repo gate checks (`-- --strict` also fails on pending ones).

Public site (details in [docs/WEB.md](docs/WEB.md)):

- `npm run dev-images` generates local dev photos (once), then `npm run build -w apps/web` builds in fixture mode (noindex).
- `npm run check:site` builds and runs the page and budget checks.
- Browser checks, each needs Chrome and a built `apps/web/dist`, run one at a time and never during `npm test`:
  `npm run design-check`, `npm run image-fit`, `npm run lightbox-network`, `npm run lightbox-a11y`, `npm run phone-bytes`.
- Images come in WebP tiers 480, 720, 960, 1600 and 2400; the album lightbox loads the fit tier first and the master only on zoom.

Copy `.env.example` for local settings; never commit real values. The web build reads only `PUBLIC_SITE_ENV`,
`PUBLIC_SNAPSHOT_URL` and `PUBLIC_IMG_BASE_URL` (all unset means fixture mode).

## More

- Plan: MASTERPLAN (kept in the autopilot project state folder).
- Public site: [docs/WEB.md](docs/WEB.md); design-check baseline: [docs/DESIGN-CHECK.md](docs/DESIGN-CHECK.md).
- Admin app (architecture, env, deploy steps, check commands, deviations, Czech guide): [docs/ADMIN.md](docs/ADMIN.md); spec: [docs/ADMIN-UX.md](docs/ADMIN-UX.md); Worker deploy: [docs/DEPLOY-API.md](docs/DEPLOY-API.md).
- Legacy photo migration (usage, flags, human run checklist, rollback): [docs/MIGRATION.md](docs/MIGRATION.md).
- Unconfirmed platform facts and human to-dos: [docs/VERIFY.md](docs/VERIFY.md).
