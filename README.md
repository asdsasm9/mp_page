# Mullny Photos

Monorepo for the new mullnyphotos.cz: a static Astro public site, a React admin, a Cloudflare Worker API and shared contracts. This is a scaffold; features arrive in later work packages.

The old CRA site lives on the `main` branch and the git tag `legacy-cra` (a hotfix to it means checking out that tag). Old photos are kept in `legacy/`.

## Workspaces

| Path | What |
|------|------|
| `apps/web` | Astro static public site (lang `cs`) |
| `apps/admin` | Vite + React 18 admin |
| `apps/api` | Cloudflare Worker stub (`/health`), never deployed from here |
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

Copy `.env.example` for local settings; never commit real values.

## More

- Plan: MASTERPLAN (kept in the autopilot project state folder).
- Unconfirmed platform facts and human to-dos: [docs/VERIFY.md](docs/VERIFY.md).
