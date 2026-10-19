# Design-check baseline (WP3-25)

Run date: 2026-10-19. Command: `npm run design-check` (Chrome found automatically at
`/Applications/Google Chrome.app/...` when `CHROME_PATH` is unset). Tools: lighthouse 13.5.0,
puppeteer-core 25.14.0, axe-core 4.14.0. Build: local fixture build of `apps/web` (noindex), served by
`scripts/serve-dist.mjs` (CSP from `_headers`, gzip for text). Lighthouse: mobile profile, simulated slow 4G, median of 3.

Verdict of the last run: `DESIGN_CHECK: FAIL`, one miss (listed below). Everything else passes.

## Numbers (Lighthouse mobile, median of 3)

| Page | Perf | A11y | BP | SEO* | LCP ms | CLS | TBT ms | axe | Tab stops | Overflow 320 | Console |
|---|---|---|---|---|---|---|---|---|---|---|---|
| / | 0.98 | 1 | 1 | 1 | 2404 | 0.000 | 0 | 0 | 20 | 0 | 0 |
| /svatby/ | 0.95 | 1 | 1 | 1 | **2928** | 0.000 | 0 | 0 | 29 | 0 | 0 |
| /svatby/sedlakovi/ | 1.00 | 1 | 1 | 1 | 1879 | 0.000 | 0 | 0 | 64 | 0 | 0 |
| /o-mne/ | 0.98 | 1 | 1 | 1 | 2403 | 0.000 | 0 | 0 | 21 | 0 | 0 |
| /kontakt/ | 1.00 | 1 | 1 | 1 | 1654 | 0.000 | 0 | 0 | 19 | 0 | 0 |
| /cookies/ (axe, reflow, keyboard only) | | | | | | | | 0 | 19 | 0 | 0 |
| /neexistuje/ (404) | | | | | | | | 0 | 20 | 0 | 0 |

\* SEO is scored without the `is-crawlable` audit. Every non-production build is `noindex` on purpose (plan 4.1),
which caps the raw SEO score at 0.69. The raw value is kept in the report as `crawlable`. That the production build
is indexable is covered by the build guard and the cutover checklist (`PUBLIC_SITE_ENV=production`, view-source has no `noindex`).

Thresholds: performance >= 0.95, accessibility 1, best-practices 1, seo 1, LCP <= 2500 ms, CLS <= 0.1, zero serious/critical axe,
no console errors, no horizontal scroll at 320 px, every Tab stop has a visible focus indicator and is not covered.

INP is not measurable in a lab run (it needs real user interaction and field data). TBT is 0 ms on every page, which is
only a proxy. INP is not claimed as passed.

## Remaining miss

- `/svatby/` LCP 2928 ms vs 2500 ms. LCP element is the first album cover (`fetchpriority=high`, eager). Load delay and
  render delay are small (under 60 ms each); the time is the 173 KB `960.webp` variant of that cover on simulated slow 4G
  (about 1.6 Mbit/s) plus the unavoidable HTML to CSS to image round trips. Fix: add a ~720 px variant to the image
  pipeline so a 412 px wide phone at 1.75x does not need the 960 px file, or recompress the cover variants (target about 100 KB).
  Owner: image variants (WP-2 pipeline, admin side). Not fixable in components without changing the variant set.

## Findings fixed in this run

- `/cookies/` overflowed 272 px at 320 px (definition list with `max-content` column). Now one column below 48rem.
- `/kontakt/` Instagram button showed the legacy feed screenshot (`instagram.png`, 865 px photo grid) shrunk to 24 px
  as its "icon". Replaced by an inline SVG glyph in `currentColor`. The unused asset was deleted (T-96) and removed from
  `scripts/site-images-import.mjs`.
- Eager, non-LCP images now get `fetchpriority="low"` so they do not compete with the LCP image (category LCP 3228 to about 2930 ms).
  Caveat: `loading="eager"` is only for the hero or the first row of tiles. Eager images further down the page get
  `fetchpriority="low"` and gain nothing from being eager; keep everything else lazy.
- The 404 page's own HTTP 404 status was reported as a console error; only that exact document message is now ignored.
- Lab server now gzips text types like the real host (home LCP 2553 to 2404 ms).
- Tooling: Chrome autodetect (macOS paths), `is-crawlable` handling, scripted keyboard pass, dark-scheme screenshots,
  lazy images scrolled into view before full-page screenshots (otherwise grey boxes), `scripts/lcp-probe.mjs` diagnostic.

## Screenshots (`.tmp/design-check/`, git-ignored)

`<name>-<360|1280>.png`, `<name>-768.png` and `<name>-<360|1280>-dark.png` for names home, category, album, about,
contact, cookies, 404. Inspected for this baseline: home-1280, home-360-dark, home-1280-dark, category-360, cookies-360,
contact-360, contact-1280, album-1280, 404-768. The site is light-only (`color-scheme: light`), so dark screenshots look
identical to light, as intended. Observed: consistent header/footer, readable type, no truncation, no layout breaks.
Not covered by tokens: nothing found by the checks.

## Image fit (`npm run image-fit`)

Checks every photo on `/`, `/svatby/` and an album page at 360/412/768/1280/1920 px x DPR 1/2/3: file width >= rendered
width x DPR and <= 1.6 x that, CLS 0. Needs a built `apps/web/dist` and Chrome (`CHROME_PATH` or a standard install).
Statuses that do not fail: `floor` (smallest tier already), `cap` (largest tier the photo has), `ladder` (see below).

- Finding (R3, deferred): at 360 px and DPR 3 a card slot needs 984 px; the 960 tier is 2.4% short, so the browser takes
  1600 (ratio 1.63). Adam's priority (D-8) is full quality, so this is accepted and reported as `ladder`. A 1200 px tier
  would cut about 35% of the bytes for DPR 3 phones at 360 px; it needs a contract change (tier list, quota, seed,
  encoder) and Adam's approval.
- Sizes found by the first real run and fixed: card `sizes` now uses `min((100vw - 7rem) / 3, 24.5rem)` (real column
  219.5 px at 768 px), and home review photos use their own `review` context.

## Not done / limits

- Lighthouse numbers come from a laptop and vary by about 100 to 300 ms between runs; rerun before relying on a 50 ms margin.
- Concurrent `astro build` runs in `apps/web` collide: Astro writes `apps/web/.astro/.prerender` and has no CLI flag or
  config key to relocate it (`cacheDir` only moves the Vite cache, `--outDir` only the output). `Base.test.ts` builds with
  `--outDir <tmp>`, so do not run `npm run build -w apps/web` or `npm run design-check` while `npm test` runs; run them one
  after the other.
- A production build has no `noindex`: the `robots` check in `scripts/site-checks.mjs` (page-checks gate) fails a production
  build with `noindex` on any indexable page and requires it on the 404 page; its tests are in `scripts/site-checks.test.mjs`
  ("robots"). The design-check itself only ever builds the noindex fixture.
- Photos in the fixture are the dev images in `/_dev-img`; production numbers need a snapshot build against the real image host.
