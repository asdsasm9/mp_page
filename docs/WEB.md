# Public site (`apps/web`)

Static Astro site, Czech (`lang="cs"`), built from a catalog snapshot. It needs neither Supabase nor the Worker at run time.
Plan: WP-3 and WP-3b (image loading). Related: [SEO.md](SEO.md), [DESIGN-CHECK.md](DESIGN-CHECK.md),
[DESIGN-TOKENS.md](DESIGN-TOKENS.md), [TEXTS-REVIEW.md](TEXTS-REVIEW.md), [VERIFY.md](VERIFY.md).

## Build modes

The mode comes from three public variables (names only in `.env.example`; the build never receives secrets):

| Variable | Meaning |
|---|---|
| `PUBLIC_SNAPSHOT_URL` | https URL of the published snapshot JSON. Unset means fixture mode. |
| `PUBLIC_IMG_BASE_URL` | Image host (https). Unset in fixture mode means `/_dev-img`. Required in snapshot mode; its host must equal the snapshot host. |
| `PUBLIC_SITE_ENV` | `production` or `preview`. Anything else or unset means a non-production build. |

| Mode | Data | Images | Indexing |
|---|---|---|---|
| Fixture (default, local) | `packages/shared/fixtures/snapshot.fixture.json` | dev images in `/_dev-img` | `noindex` (meta, header, `robots.txt` Disallow) |
| Snapshot, preview | fetched at build time (no-store, 15 s timeout, 3 retries) | `PUBLIC_IMG_BASE_URL` | `noindex` |
| Snapshot, `PUBLIC_SITE_ENV=production` | same | same | indexable |

The snapshot is checked with `SnapshotSchema.parse` and `assertPublishable`; any failure fails the build, so the previous
deploy stays live. `production` also requires snapshot mode, an https image base and no `_dev-img` directory in `dist`
(otherwise the build fails). Forgetting the variable at cutover costs visibility (the site stays `noindex`), not a leak.
The canonical origin is the `site` value in `apps/web/astro.config.mjs`, never the deploy host.

## Commands

All from the repository root, one at a time (see the note on concurrent builds below).

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (Node 22, see `.nvmrc`). |
| `npm run dev-images` | Generate dev images for fixture mode into `apps/web/public/_dev-img/` (gitignored). See below. |
| `npm run build -w apps/web` | `astro build` then `scripts/postbuild.ts`, which writes `dist/_redirects`, `dist/_headers`, `dist/_publish.json`. |
| `npm run dev -w apps/web` | Astro dev server for editing. |
| `npm run check:site` | Build in the current mode, then `scripts/site-checks.mjs` (`page-checks` and `budget`) over `dist`. |
| `npm run gates` | Repository gates (secrets, env example, dist checks, migrations lint and so on). `-- --strict` also fails on PENDING. |
| `npm test`, `npm run typecheck` | Unit tests (Vitest) and `tsc` in every workspace. |

Do not run `npm run build -w apps/web`, `npm run check:site`, `npm run design-check` or the browser checks below while
`npm test` is running, or two of them at once: Astro writes `apps/web/.astro/.prerender` and concurrent builds collide.

### Dev images

In fixture mode the snapshot refers to photo ids that do not exist on any image host. `npm run dev-images` creates the
variants (WebP 480, 720, 960, 1600, 2400, JPEG, OG, master) from the old photos in `legacy/fotky_web/galleries/` (read-only);
a photo whose source file is missing gets a solid dominant-colour image of the right size. It is idempotent (`--force`
rebuilds). The output is gitignored and a production build refuses to ship it. Run it before the browser checks.

### Browser checks (need Chrome, a built `apps/web/dist`, and dev images)

Chrome is found automatically on macOS, or set `CHROME_PATH`. Exit 0 pass, 1 fail, 2 skipped (no Chrome). They serve `dist`
with their own small server, `scripts/serve-dist.mjs` (CSP from `_headers`, gzip for text, `404.html`) and use puppeteer-core, lighthouse and axe-core.

| Command | Checks |
|---|---|
| `npm run design-check` | Screenshots at three widths (light and dark), Lighthouse mobile (median of 3), axe, scripted keyboard pass, 320 px reflow, console errors. Verdict line `DESIGN_CHECK: PASS`. Baseline and thresholds: [DESIGN-CHECK.md](DESIGN-CHECK.md). |
| `npm run image-fit` | For `/`, `/svatby/` and an album at 360 to 1920 px and DPR 1, 2, 3: loaded file width is at least rendered width x DPR and at most 1.6x that; CLS 0. Verdict `IMAGE_FIT: PASS`. `ladder` results (360 px at DPR 3 takes 1600 instead of a short 960) are accepted quality-first (D-8). |
| `npm run lightbox-network` | Staged loading: no master and no 2400 file on page load; opening fetches the fit tier only; the first zoom fetches the master exactly once; after close and reopen no extra master request. Verdict `LIGHTBOX_NETWORK: PASS`. `-- --throttle` emulates slow 4G. |
| `npm run lightbox-a11y` | Keyboard-only use, focus trap and return, announcements, reduced motion, axe on the open dialog, CDP touch (double-tap, pinch, pan, cancel). Verdict `LIGHTBOX_A11Y: PASS`. |
| `npm run phone-bytes` | Real image bytes a 412 px phone downloads on first paint of an album page at DPR 1.75 and 3 (the `budget` gate counts only eager images, so it undercounts). Prints numbers, no verdict. |

## Images and the lightbox

- Tiers: WebP 480, 720, 960, 1600, 2400 (only those not wider than the source), a 1600 px JPEG fallback, an OG JPEG and the
  master. The 720 tier exists so a phone (412 px at DPR 1.75 needs about 665 px) does not take 960. Photos stored before the
  tier existed have a srcset without 720 and fall back to 960 (still valid, see [DATA-MODEL.md](DATA-MODEL.md)).
- Cards and the album grid use 480, 720, 960 (and 1600 on dense screens) through `sizes`; the initial markup never contains
  2400 or the master. Each image has width and height and a dominant-colour placeholder (`--c`), so there is no layout shift.
  Only the hero or first tile is `loading="eager"`; the rest is lazy.
- Album pages open a native `<dialog>` lightbox (`src/scripts/lightbox*.ts`, about 4 KB gzip). Loading is staged: the
  1600/2400 WebP that fits the screen first, the master only when the visitor zooms, and it is dropped again on close.
- Controls: click or Enter on a thumbnail opens; Left/Right (or the buttons) change photo; `+`, `-`, `0` or the +/-/1x
  buttons zoom; Ctrl+wheel zooms; arrow keys pan while zoomed; Escape closes and focus returns to the thumbnail. Touch:
  double-tap zoom, pinch, one-finger pan. Zoom level is announced politely; `prefers-reduced-motion` removes transitions.
  The page behind never scrolls or zooms while the dialog is open.
- Masters are always re-encoded, never the original file, so EXIF/GPS are stripped; the dev-image generator has a test for it
  (`scripts/dev-images.test.ts`), and WP-5 and the migration must keep the rule (ADMIN-UX.md section 3.5).

## Publish to deploy

Publishing in the admin makes the Worker write the snapshot JSON to the image host; it then calls the Pages deploy hook
(`PAGES_DEPLOY_HOOK_URL`, a Worker secret), the hosting project runs `npm run build -w apps/web` with the three variables
above, and the new site replaces the old one only if the build succeeds. The built site exposes `/_publish.json` (`snapshotGeneratedAt`, `builtAt`, counts) to confirm which snapshot went live. Details on the Worker side: [DEPLOY-API.md](DEPLOY-API.md).
Whether Pages or Workers static assets is used, and deploy-hook support, are UNVERIFIED (VERIFY.md row 2).

## Cutover checklist (web part)

Human steps; the autopilot cannot do them.

1. Production project has `PUBLIC_SITE_ENV=production`, `PUBLIC_SNAPSHOT_URL`, `PUBLIC_IMG_BASE_URL` set.
2. After the production deploy, view-source of the home page must not contain `noindex`; `robots.txt` must not disallow all.
   Run `npm run check:site` against a production build once (the `robots` check fails a production build with `noindex`).
3. `/cookies/` has no `[doplnit]` marker left (controller name, address, IČO, date); `page-checks` only warns on a
   non-production build and fails a production one.
4. Test about 10 old URLs (hash links such as `#/portfolio`, `/fotky_web/galleries/...` images, album paths) against
   `_redirects`; check `404.html` on an unknown path (VERIFY rows 17, 18, 22, 23).
5. Submit `sitemap.xml` in Search Console.
6. Run Google Rich Results Test and the Schema.org validator once on the home page and an album.
7. Apex to www redirect and HSTS in Cloudflare (H-5).
8. Phone check of the lightbox gestures on a real iPhone and Android (VERIFY row 24).

## Photographer checklist: keyboard and phone

Keyboard only (no mouse): Tab reaches the skip link ("Přeskočit na obsah"), logo, menu, then page links in a logical order, each with a visible focus
ring; the menu works with Enter/Escape; on an album, Tab to a thumbnail and press Enter, change photos with the arrows,
zoom with `+`, pan with arrows, `0` for the whole photo, Escape closes and puts you back on the same thumbnail.

Phone (portrait and landscape): no sideways scrolling; text readable without zooming; photos sharp and not slow to appear
(a grey-coloured block first, then the photo); in the lightbox, pinch and double-tap zoom the photo, one finger moves it,
the page behind does not move; menu and links are easy to hit.

## Open questions for the photographer

Placeholders ship until answered (none blocks the build; controller details block cutover). See
[TEXTS-REVIEW.md](TEXTS-REVIEW.md) for the wording.

- Q-1 product photography offered; Q-2 phone number; Q-6 own wording for the home tagline and style; Q-8 home share image;
  Q-9 portrait as share image and in `Person` markup; Q-10 street address; Q-12 price range; Q-14 copyright and licence
  wording; Q-16 client consent for names in titles and alt text.
- Approval of the typo fixes listed in TEXTS-REVIEW.md, and the `/cookies/` controller details (cutover blocker).

## Known limits

- Lighthouse numbers vary by 100 to 300 ms between sessions; `/svatby/` LCP passes by only 22 ms (DESIGN-CHECK.md).
- INP is not lab-measurable and is not claimed.
- `design-check` and the other browser checks run against the fixture build with dev images, not production images.
- A 1200 px tier would cut bytes for 3x phones at 360 px but needs a contract change and approval (DESIGN-CHECK.md, R3).
