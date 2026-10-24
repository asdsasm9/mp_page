# Public site (`apps/web`)

Static Astro site, Czech (`lang="cs"`), built from a catalog snapshot. It needs neither Supabase nor the Worker at run time.
Plan: WP-3 and WP-3b (image loading). Related: [SEO.md](SEO.md), [DESIGN-CHECK.md](DESIGN-CHECK.md),
[DESIGN-TOKENS.md](DESIGN-TOKENS.md), [TEXTS-REVIEW.md](TEXTS-REVIEW.md), [VERIFY.md](VERIFY.md).

## Structure (since WP-12)

Home (`/`) is a one-pager with the sections Hero (T-326: exactly the window tall, `block-size` `100vh` then `100svh` then `100dvh`, starting at the very top under the overlaying header; no minimum floor; T-327: h1 "Fotografie, která zachytí váš příběh" (`HERO_TITLE`, uppercase by `.t-display`, `text-wrap: balance`), the kicker, h1 and button are centred in a block of at most 60rem at the bottom over the scrim, brand stays in title/meta/JSON-LD/wordmark; the text block fits down to 320x480 and 640x360; image `object-fit: cover` with `--hero-position: center 40%`), O mně (`#o-mne`: the short hello and a "Více o mně" link to `/o-mne/`; T-330: from 48rem up and above 32rem window height, O mně, Portfolio and Reference (T-335: Kontakt is no longer in a shared wrapper, it keeps its own band at content height) are at least `--section-min-block` = window height minus the sticky header (`.fill-tall`, `vh` then `dvh`), content centred vertically (`.fill`), taller content grows the block; phones, short landscape and all other pages keep content height),
Portfolio (category cards), Reference (T-333, D-25: each review shows its author's portrait, the review album's cover, round, `--profile-size` 12rem from 48rem directly to the LEFT of the text (T-335; the DOM keeps the text first, grid areas swap them; text column at most 36rem, gap `--space-6`), text and portrait centred together as one group in the band and vertically centred against each other; the arrows and counter are centred; Reference is on its own at least `--section-min-block` tall from 48rem (`fill fill-tall`) with `--space-8` between title and content (`--space-7` on phones); phones stack text then portrait, the quote block and the caption centred as blocks (quote lines left-aligned, caption text centred, both at most 36rem), `--profile-size-compact` 6rem; `Photo crop="profile"`, lazy, alt "Name, klientka"; it is inside the slide so it changes with the carousel; no cover in the snapshot means no photo and no gap) and Kontakt (`#kontakt`), then the footer (`src/components/sections/`). Further
pages: `/o-mne/` (the About page again since T-293, with the three texts, the full quote and two photos, rebuilt in T-319 as four bands ground / surface / dark / ground: PageHead with the lead, "Mé zkušenosti" and "Můj příběh" as `h2.t-h3` beside the two photos (first photo level with the first sub-head from 48rem, photos after the first text on phones, natural aspect ratio), the quote as `.t-quote` in `<Section band="dark" size="h3">`, and the "Napište mi" button; two font families, the type tokens only; the header item
"O mně" links to it and is marked `aria-current="page"` there), `/portfolio/`, one page per category, one per album,
`/cookies/` and the 404. The header item "Portfolio" links to `/portfolio/` from every page, also on the home (T-296);
it is marked `aria-current="true"` on `/portfolio/`, category and album pages and never by the home scrollspy (the
home Portfolio section keeps `id="portfolio"` and its "celé portfolio" link). Header items, in order (T-325, renamed from "Hlavní" in T-334): Úvod
(`/`, the same target as the wordmark: on `/` it scrolls to the very top and drops any `#hash`, elsewhere it opens `/`),
O mně, Portfolio and a framed Kontakt. The Reference section stays on the home page but has no header item. Úvod is
`aria-current="page"` only on `/` while the hero is in view or at the top (server-rendered, then kept by the scrollspy:
`location` goes to Kontakt when it is in view); the wordmark and Úvod stay two separate links. There is no `/kontakt/` page (it redirects to the home section); `/about` and `#/about` redirect
to `/o-mne/`. Look: [DESIGN-TOKENS.md](DESIGN-TOKENS.md) (Cormorant Garamond headings, Lora text, warm paper, gold stroke).
`docs/DESIGN-CHECK.md` is the historical WP-3 baseline.

## Build modes

The mode comes from three public variables (names only in `.env.example`; the build never receives secrets):

| Variable | Meaning |
|---|---|
| `PUBLIC_SNAPSHOT_URL` | https URL of the published snapshot JSON. Unset means fixture mode. |
| `PUBLIC_IMG_BASE_URL` | Image host (https). Unset in fixture mode means `/_dev-img`. Required in snapshot mode; its host must equal the snapshot host. |
| `PUBLIC_SITE_ENV` | `production` or `preview`. Anything else or unset means a non-production build. |
| `PUBLIC_ADMIN_ORIGIN` | Optional. One exact origin of the admin app (for example `https://admin.example.cz`). See below. |

`PUBLIC_ADMIN_ORIGIN` lets the admin read `/_publish.json` to follow a publish. When set, the `_headers` rule for
`/_publish.json` (and only that path) gets `Access-Control-Allow-Origin: <origin>` and `Vary: Origin`; a plain GET needs
no preflight, no credentials are allowed and there is never a wildcard. Unset means no CORS header (the admin then falls
back to "build triggered"). A malformed value (wildcard, path, trailing slash, query, credentials, not a URL, or `http`
in a production build) fails the build with a message naming the variable. The CSP and all other headers are unchanged.
Admin deploy steps, including setting this variable: [ADMIN.md](ADMIN.md) "Deploying the admin" (VERIFY row 28).

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
3. `/cookies/` has no `[doplnit]` marker left (controller name, address, date; IČO is optional and its line is omitted unless
   `COOKIES.controller.companyId` is set, so a private person without IČO is fine); `page-checks` only warns on a
   non-production build and fails a production one.
4. Test about 10 old URLs (hash links such as `#/portfolio`, `/fotky_web/galleries/...` images, album paths) against
   `_redirects`; check `404.html` on an unknown path (VERIFY rows 17, 18, 22, 23).
5. Submit `sitemap.xml` in Search Console.
6. Run Google Rich Results Test and the Schema.org validator once on the home page and an album.
7. Apex to www redirect and HSTS in Cloudflare (H-5).
8. Phone check of the lightbox gestures on a real iPhone and Android (VERIFY row 24).
9. Analytics: do the five human steps in [Analytics](#analytics), human steps below (WP-8 links here).
10. Cutover cannot happen until VERIFY rows 3, 11, 12, 13, 14 and 17 in [VERIFY.md](VERIFY.md) are recorded as checked, each with a date
    (these are the "Known unproven" rows in [WP8-VERIFICATION.md](WP8-VERIFICATION.md#known-unproven-0-eur-and-no-care-claims)).
    A row still UNVERIFIED or HUMAN blocks the go-live.

## Cloudflare dashboard settings and link previews

Dashboard-only settings (T-322, human step H-21, VERIFY row 61). Nothing in the repository can switch them on or off.

| Setting | Required value | Why |
|---------|----------------|-----|
| Security > Settings (or Scrape Shield) > Email Address Obfuscation | OFF | When on, Cloudflare rewrites the `mailto:` link to `/cdn-cgi/l/email-protection` and the visible address to "[email protected]". The CSP blocks its decode script, so "Napsat e-mail" opens an empty page and the address never shows. The site already prints the address as plain text |
| Security > Bots > Bot Fight Mode, "Block AI bots", managed robots.txt | Off, or a skip rule (next row) | They answer preview crawlers with a challenge or a block; the shared link then has no picture and no text. A managed robots.txt also overwrites the site's own `robots.txt` |
| Security > WAF > custom rule "Skip" for user agents containing `facebookexternalhit`, `Facebot`, `WhatsApp`, `LinkedInBot`, `Slackbot`, `Twitterbot`, `TelegramBot`, `Googlebot` | Present, action Skip (all remaining custom rules, Bot Fight Mode, rate limits) | Keeps the preview and search crawlers out of every challenge. Check Security > Events for past blocks of these user agents |
| Rules > Redirect Rules: apex `mullnyphotos.cz` to `https://www.mullnyphotos.cz` (301, keep path and query) | Present | Today both hosts serve the page; the canonical host is `www` (SEO.md section 1) and a share of the apex URL would split previews and counts |
| Caching > Purge Everything | After every change above | Cached pages keep the old rewritten mailto link until purged |

E-mail links in code (T-332): the built HTML always has the plain `mailto:mullnyphotos@gmail.com` href; the empty page came only from Cloudflare rewriting it at the edge. Every mailto link is therefore wrapped in `<!--email_off-->...<!--/email_off-->` (Contact.astro, Footer.astro, cookies page), the marker Cloudflare documents for leaving a region untouched, so the link works even with obfuscation on (the H-21 setting stays OFF as defence in depth). Astro keeps these comments in the output. The `page-checks` gate (`checkEmailProtection` in `scripts/site-checks.mjs`) fails when a built page has a mailto link outside the markers or any `/cdn-cgi/l/email-protection` string. A new template that renders the address must keep the markers.

The pages carry `og:image`, `og:image:secure_url`, `og:image:type` (`image/jpeg`), `og:image:width`, `og:image:height` and `og:image:alt` on every page that has a picture (`Base.astro`; `OgImage.type` in `apps/web/src/lib/images.ts`), and the picture URL is always absolute https.

Link-preview test procedure, after the settings above and a deploy:

1. Facebook Sharing Debugger (`developers.facebook.com/tools/debug/`): paste the page URL and press "Scrape Again"; check that image, title and description show and that "Fetched" has no error.
2. opengraph.xyz: paste the URL and check the preview cards for Facebook, LinkedIn and X.
3. LinkedIn Post Inspector (`linkedin.com/post-inspector/`): inspect the URL.
4. Chat apps (WhatsApp, Messenger, Slack) cache a preview for days: share `https://www.mullnyphotos.cz/?v=2` (and `?v=3` next time) to bypass the cache; the query string only changes the cache key, the canonical stays without it.
5. Click "Napsat e-mail" on `/` and check that the mail program opens with the address filled in and that the visible address reads correctly.

## Analytics

Cloudflare Web Analytics only (D-3 option C): no cookies, no banner, no Google, no GTM. Nothing else is measured.

- Variable: `PUBLIC_CF_ANALYTICS_TOKEN` (public value, it appears in every page's HTML; never committed, `.env.example` has the name only).
- Production only: it is read only when `PUBLIC_SITE_ENV=production`. Local and preview builds ignore it even if set. A blank value
  means off. A value that is not 16 to 64 letters and digits fails the build (the message names the variable, not the value).
- Tag: one `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "..."}'></script>`
  at the end of `<head>` on every page of `apps/web` (including 404). The form is `type="module"` as in Cloudflare's docs, not `defer`.
- CSP hosts, added only when on: `script-src https://static.cloudflareinsights.com` and `connect-src https://cloudflareinsights.com`.
  Exact hosts, no wildcard. When off the CSP is unchanged.
- Beacon size: TO VERIFY at the first deploy (expected about 5 to 6 KB gzip; not counted by the first-load budget). Record the real
  figure here after the first deploy.
- Switch it off: unset `PUBLIC_CF_ANALYTICS_TOKEN` in the Pages production environment and redeploy.
- What the page shows when off: no beacon tag, no Cloudflare host in the CSP, and `/cookies/` has no analytics paragraph (it only says
  the site stores nothing).
- The Pages "automatic setup / Web Analytics" toggle must stay OFF on both Pages projects (`web` and `admin`); otherwise a second beacon
  is injected and the admin is measured.
- Checks: a render test (`Analytics.render.test.ts`, Astro container API) pins the tag; `checkAnalyticsOutput` in the postbuild step
  fails the deploy if there is not exactly one beacon tag per page, if the CSP lacks the hosts, or if `gtag`/Google appears; gates fail if
  the beacon shows up in the admin dist or the API. An injected tag outside `dist` is only caught by the human check.

### Analytics: human steps

1. Adam, Cloudflare dashboard: create a Web Analytics site for `www.mullnyphotos.cz` using the manual snippet option and copy the token.
   Keep the Pages automatic setup toggle OFF on both the `web` and `admin` Pages projects.
2. Adam, Pages `web` project, Production environment only (not Preview): set `PUBLIC_CF_ANALYTICS_TOKEN`, then redeploy.
3. Adam, after the first production deploy: the browser check (VERIFY row 10). View-source shows one beacon tag; the network panel shows
   only the two Cloudflare hosts; the Application tab shows no cookies and empty local and session storage after three pages; the dashboard
   shows the visit. If a cookie or storage entry appears: remove the variable, redeploy, tell the architect (option C premise broken).
4. The photographer approves the Czech analytics paragraph and gives the controller details (H-7; filled in by T-313, house number still to VERIFY).
5. Optional: read the dashboard monthly; no alerting by design.

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
- Approval of the typo fixes listed in TEXTS-REVIEW.md, and the `/cookies/` controller details: name and address (cutover blocker); IČO only if she has one.

## Launch decisions (open)

- Q-12 price range: the price range in the structured data (`priceRange`) and any price wording is a placeholder until the photographer
  answers. Decide before cutover: publish a real range, or leave the field out. Do not launch with an invented figure.
  Default: the site publishes no prices and `apps/web/src/lib/jsonld.ts` emits no `priceRange` (checked 2026-10-21; the word appears only
  in a comment). Whether regular paid work needs a trade licence (živnost) before prices are published is a question for a Czech tax
  adviser or the finanční úřad; the project does not decide it. Prices can be added later by a small change in the texts and in `jsonld.ts`.
- Home SEO check (T-211, 2026-10-21): the title ("Fotograf Brno: svatby, portréty, páry | Mullny Photos") and the description
  (`homeMeta` in `apps/web/src/lib/seo.ts`) target "fotograf Brno". The H1 is only the brand "Mullny Photos" and the tagline under it
  ("Focení svateb, portrétů a párových fotek", `SITE.description`) does not name Brno. Whether to put "Brno" into the visible H1 or tagline
  is a copy decision for the photographer (Q-6); the hero image alt text already says Brno.

## Credits

- The footer MyWed icon (T-294) is MyWed's official logo symbol (the hexagon mark, wordmark removed) from their logotypes page,
  https://mywed.com/en/logotypes/. It is inlined in `apps/web/src/components/Icon.astro` (name `mywed`, single colour, `currentColor`)
  and is used only to link to the photographer's MyWed profile, not as a badge or endorsement.

## Known limits

- Lighthouse numbers vary by 100 to 300 ms between sessions; `/svatby/` LCP passes by only 22 ms (DESIGN-CHECK.md).
- INP is not lab-measurable and is not claimed.
- Deleted-album URLs answer 404, not 410 (approved temporary deviation, D-14). `redirects.ts` drops 410 rows because Cloudflare Pages support for status 410 in `_redirects` is unverified (VERIFY row 17). After a human confirms row 17 (H-13), the autopilot flips `emit410`.
- `design-check` and the other browser checks run against the fixture build with dev images, not production images.
- A 1200 px tier would cut bytes for 3x phones at 360 px but needs a contract change and approval (DESIGN-CHECK.md, R3).
