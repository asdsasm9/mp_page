# Design-check baseline (WP3-25)

> HISTORICAL (WP-3, the pre-WP-12 look, 2026-10-19/20). The tables below describe the old site, including `/o-mne/` and
> `/kontakt/`, which no longer exist (WP-12 moved them into the home page as sections). The current routes are in
> `scripts/design-check.mjs`; current LCP, CLS and font numbers are in the project LOG (T-282, T-274..T-289).

Run date: 2026-10-19. Command: `npm run design-check` (Chrome found automatically at
`/Applications/Google Chrome.app/...` when `CHROME_PATH` is unset). Tools: lighthouse 13.5.0,
puppeteer-core 25.14.0, axe-core 4.14.0. Build: local fixture build of `apps/web` (noindex), served by
`scripts/serve-dist.mjs` (CSP from `_headers`, gzip for text). Lighthouse: mobile profile, simulated slow 4G, median of 3.

Verdict of the last run: `DESIGN_CHECK: PASS`. Updated 2026-10-20 (WP3b-20, T-115) after the image-loading work package
(720 px tier, quality-first `sizes`, blur-less colour placeholders, staged zoomable master lightbox). The run was repeated
three times, one after the other, never during `npm test`.

## Numbers (Lighthouse mobile, median of 3 inside each run)

Final state, run 3 of 3 (the first baseline from WP-3 is in the last column for comparison):

| Page | Perf | A11y | BP | SEO* | LCP ms | CLS | TBT ms | axe | Tab stops | Overflow 320 | Console | WP-3 LCP ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| / | 0.98 | 1 | 1 | 1 | 2403 | 0.000 | 0 | 0 | 20 | 0 | 0 | 2404 |
| /svatby/ | 0.98 | 1 | 1 | 1 | 2478 | 0.000 | 0 | 0 | 29 | 0 | 0 | 2928 |
| /svatby/sedlakovi/ | 1.00 | 1 | 1 | 1 | 1728 | 0.000 | 0 | 0 | 64 | 0 | 0 | 1879 |
| /o-mne/ | 0.98 | 1 | 1 | 1 | 2328 | 0.000 | 0 | 0 | 21 | 0 | 0 | 2403 |
| /kontakt/ | 1.00 | 1 | 1 | 1 | 1655 | 0.000 | 0 | 0 | 19 | 0 | 0 | 1654 |
| /cookies/ (axe, reflow, keyboard only) | | | | | | | | 0 | 19 | 0 | 0 | |
| /neexistuje/ (404) | | | | | | | | 0 | 20 | 0 | 0 | |

All three runs for the pages named in the task (LCP ms / CLS / perf):

| Page | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| / | 2406 / 0.000 / 0.98 | 2404 / 0.000 / 0.98 | 2403 / 0.000 / 0.98 |
| /svatby/ | 2478 / 0.000 / 0.98 | 2478 / 0.000 / 0.98 | 2478 / 0.000 / 0.98 |
| /svatby/sedlakovi/ (album) | 1729 / 0.000 / 1.00 | 1728 / 0.000 / 1.00 | 1728 / 0.000 / 1.00 |

Other pages, runs 1 / 2 / 3: /o-mne/ LCP 2403 / 2402 / 2328, /kontakt/ LCP 1580 / 1578 / 1655; CLS 0.000, a11y/BP/SEO 1 and
axe 0 on every page in every run. All three runs ended `DESIGN_CHECK: PASS`.

Honest reading: `/svatby/` LCP is below 2500 ms in all three runs (2478 ms each time), but the margin is only 22 ms, and
the lab varies by 100 to 300 ms between sessions (see "Not done / limits"). It is a pass, not a comfortable one. The
numbers were almost identical across the three runs here (each value is already a median of 3 Lighthouse runs), but
earlier sessions on the same machine moved by 100 to 300 ms. No quality was traded for it (D-8): the phone
gets the new 720 px tier, larger screens and denser displays keep the larger tiers.

\* SEO is scored without the `is-crawlable` audit. Every non-production build is `noindex` on purpose (plan 4.1),
which caps the raw SEO score at 0.69. The raw value is kept in the report as `crawlable`. That the production build
is indexable is covered by the build guard and the cutover checklist (`PUBLIC_SITE_ENV=production`, view-source has no `noindex`).

Thresholds: performance >= 0.95, accessibility 1, best-practices 1, seo 1, LCP <= 2500 ms, CLS <= 0.1, zero serious/critical axe,
no console errors, no horizontal scroll at 320 px, every Tab stop has a visible focus indicator and is not covered.

INP is not measurable in a lab run (it needs real user interaction and field data). TBT is 0 ms on every page, which is
only a proxy. INP is not claimed as passed.

## Real phone image bytes on an album page

The budget gate (`page-checks`) counts only eager images, and album pages now use `ALBUM_EAGER = 1`, so it undercounts what a
phone really downloads (native lazy loading also fetches the images that fall into the first viewport). `node scripts/phone-bytes.mjs`
measures it: Chrome 412x915 CSS px, touch, cache disabled, CDP encoded bytes of every image
response after `networkidle0` (no scrolling), against the local fixture build with dev images.

| Page | DPR | Image requests | Bytes | Tiers fetched |
|---|---|---|---|---|
| /svatby/sedlakovi/ (album) | 1.75 | 5 | 136 110 (133 KB) | 4 x 720 + logo |
| /svatby/sedlakovi/ | 3 | 5 | 322 664 (315 KB) | 3 x 1600, 1 x 960 + logo |
| /svatby/frankovi/ (album) | 1.75 | 6 | 327 144 (319 KB) | 5 x 720 + logo |
| /svatby/frankovi/ | 3 | 6 | 953 291 (931 KB) | 1 x 960, 4 x 1600 + logo |

So the real first-viewport weight on a 1.75x phone is 133 to 319 KB for an album, against the eager-only count of one image.
At DPR 3 it is 315 KB to 931 KB; the DPR 3 spread is the accepted quality-first ladder (D-8). Dev-image sizes differ from
production encodes, so treat the numbers as a lab measure, not a field value.

## Status of the former LCP miss

None open. `/svatby/` LCP was 2928 ms in the WP-3 baseline (173 KB `960.webp` cover) and is now 2478 ms in all three runs after
the 720 px tier was added. The margin to the 2500 ms limit is small (22 ms); rerun before relying on it.

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
