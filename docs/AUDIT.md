# Audit of the current site (T-1)

Audit date: 2026-10-19. Worktree: `work/mullnyphotos`, branch `autopilot`. Old Create React App (react-scripts 5.0.1) app, React 18, TypeScript 4.9, Tailwind 3, react-router-dom 6 (HashRouter), react-ga4. Hosted on GitHub Pages (`public/CNAME` = `www.mullnyphotos.cz`), published with the old `deploy` script (gh-pages, `-d build`; it exists only on the legacy `main` branch). `package.json` `homepage` = `https://www.mullnyphotos.cz/`.

## 1. Build health

| Step | Result |
|---|---|
| `npm install` | Works (1470 packages, "up to date"). Reports 104 vulnerabilities (14 low, 48 moderate, 36 high, 6 critical), all in the old CRA toolchain; not fixed. |
| `npm run build` | Works. "Compiled with warnings" (ESLint only, no errors). Output: `main.4ef3f3d5.js` 64.78 kB gzip, `main.37097705.css` 3.99 kB, `787.5a2180da.chunk.js` 1.78 kB. Built "assuming it is hosted at /". |

Build warnings (all non-fatal): `target="_blank"` without `rel` (BottomBar, 2x); `useEffect` missing dependency (NavMenu); logo `<img>` without `alt` (NavMenu); redundant `alt="Image"` (AboutView, ContactView, HelloView, PhotoCollage alt "Photo n"); unused imports/vars (`prototype` in AboutView, `JsxElement` in ContactView, `setPhotos` in PhotoCollage); `==` instead of `===` (GalleryPhotos, PhotosShowcase); unreachable code in `AnalyticsHandler.ts`; multi-line string literals with `\` (DataTexts, About, Contact). Also outdated caniuse-lite.

After the build, `git restore build` was run. `git clean -fd build` was denied by the permission system, so ignored build leftovers remain (see section 9); they are in `.gitignore` (`/build`) and invisible to `git status`.

## 2. Route inventory (every URL the live site serves)

Router: `HashRouter` in `src/components/AppComponent.tsx`. All app routes live after `#`; the server only ever serves `/` (and static files). Production host is `https://www.mullnyphotos.cz/`.

| Live URL | Component | Page title (`usePageTitle`, suffix ` \| MullnyPhotos`) | Notes |
|---|---|---|---|
| `/` and `/#/` | redirect | (none) | `path="/*"` -> `<Navigate to="/home">`, so lands on `/#/home` |
| `/#/home` | `pages/Home` | Úvod | Linked from logo and "Úvod" |
| `/#/portfolio` | `pages/Portfolio` | Portfólio (sic) | Linked from "Portfolio" nav button only; page shows the 3 category cards + reviews |
| `/#/weddings` | `pages/Weddings` | Svatby | List of 4 weddings |
| `/#/weddings/frankovi` | `PhotosShowcase` (WEDDING) | Fotogalerie | album "Michal & Rozárka", 5 photos |
| `/#/weddings/hradsti` | same | Fotogalerie | "Jitka & Tomáš", 8 |
| `/#/weddings/sedlakovi` | same | Fotogalerie | "Adam & Eliška", 44 |
| `/#/weddings/suranovi` | same | Fotogalerie | "Broňa a Prokop", 5 |
| `/#/portraits` | `PhotosShowcase` (PORTRAITS) | Fotogalerie | all 6 portrait albums stacked on one page |
| `/#/couples` | `PhotosShowcase` (COUPLES) | Fotogalerie | all 3 couple albums stacked on one page |
| `/#/about` | `pages/About` | O mně | |
| `/#/contact` | `pages/Contact` | Kontakt | |
| `/#/<anything else>` | redirect | n/a | e.g. `/#/weddings/typo` is NOT caught by the wildcard (matches `/weddings/:wedding_id`), see bug below; other unknown paths redirect to `/#/home` |

Other URLs served as static files from the host root: `/robots.txt`, `/manifest.json`, `/favicon.ico`, `/logo.png`, `/android-chrome-192x192.png`, `/CNAME` (GitHub Pages), `/fotky_web/**` (all images, section 6). `/#/...` is not seen by crawlers as separate pages (fragment only), so Google has effectively indexed one URL.

Legacy / alternate hosts seen in code: `https://asdsasm9.github.io/mp_page/#/home` (hardcoded in `og:url`, `twitter:url`, and `og:image` / `twitter:image` host `https://asdsasm9.github.io/mp_page/fotky_web/site/preview/preview.jpg`). That GitHub Pages project URL is a stale leftover and should be treated as a legacy URL for redirects (it presumably redirects to the custom domain or 404s; not verified, no network access in this audit).

Defined but unreachable: `src/pages/NotFound.tsx` (no route uses it; shows English "This is non found"). The `PatiReview`/`AnezReview` reviews link to nothing.

Bugs in routing:
- `/#/weddings/<unknown-id>`: `getByGalleryId` returns `undefined`, then `getAllImagesPaths(undefined)` throws, which blanks the whole app (no error boundary).
- Wedding card button uses a relative `navigate(props.weddingUrl)` (relative to `/weddings`), works only because it is rendered on `/weddings`.
- Navigation uses `<button onClick=navigate(...)>` and clickable `<div>`s, not `<a href>`; links cannot be opened in a new tab, are not crawlable, not announced as links.
- Albums within `/portraits` and `/couples` have no URL of their own (no per-album page); only weddings do.

Redirect needs for later (feed into T-2): every hash URL above, plus the `asdsasm9.github.io/mp_page` URLs. A static host cannot redirect on fragments server-side; the new site needs a small client-side script on `/` that maps `#/...` to new paths.

## 3. Components

| File | Role |
|---|---|
| `src/index.tsx` | Entry: `ReactGA.initialize("G-7QEZCZ09WY")`, renders `<App/>` in StrictMode, calls `reportWebVitals()` |
| `src/App.tsx` | Renders `AppComponent`; has a stray `console.log("app")` |
| `src/components/AppComponent.tsx` | HashRouter + routes, `ScrollToTop`, `NavMenu`, `BottomBar` |
| `components/NavMenu.tsx` (+`NavMenu.css`) | Fixed header: logo button (`/fotky_web/site/common/main_logo_2.png`, hidden below 700px), hamburger toggle (below 640px), links Úvod / Portfolio (hover dropdown: Svatby, Portréty, Párové focení) / O mně / Kontakt; background turns `#fAfAfA` on scroll |
| `components/BottomBar.tsx` | Footer: "MULLNY", "Fotím v Jihomoravskom kraji" (Slovak form, should be "Jihomoravském"), Instagram link, mailto link, MyWed badge (external image from mywed.com + link to `https://mywed.com/cs/photographer/mullny/`) |
| `components/ScrollToTop.tsx` | Scroll to top on path change |
| `components/home/HelloView.tsx` | Intro text + "ZOBRAZIT VÍC" button to `/about` + `home/hello.jpg` |
| `components/home/CategoryView.tsx` | Clickable card (div) with image and title |
| `components/home/PhotoCollage.tsx` | Quote text + 3 images (`trio1-3.jpg`); title text is empty; `setPhotos` unused |
| `components/home/Experience.tsx`, `ExperienceColumn.tsx` | "RECENZE" two review columns (Pati, Anež) using each album's main image |
| `components/weddings/WeddingView.tsx` (+css) | Alternating image/text row per wedding, `<h1>` per row, "ZOBRAZIT VÍC" button |
| `components/showcase/GalleryPhotos.tsx`, `ShowcasePhoto.tsx` | Album title + photos in two columns (md+) or one column; photo `alt` is the file path |
| `components/about/AboutView.tsx` (+css) | Image + text block |
| `components/contact/ContactView.tsx` (+css) | Image + text + button (mailto / Instagram) |
| `hooks/usePageTitle.ts` | Sets `document.title` |
| `data/AnalyticsHandler.ts` | `pushAnalysisEvent` (ReactGA.event), `pushAnalysisPageChange` (returns immediately; dead code after `return`) |
| `data/DataHandler.ts` | Filters galleries by category; builds image paths `fotky_web/galleries/<category>/<id>/<n>.jpg` for n = 1..numOfImages; main image path from `mainImgNum` |
| `pages/*` | Home, Portfolio, Weddings, PhotosShowcase, About, Contact, NotFound (unused) |

Styling: Tailwind utility classes plus hand-written CSS in `index.css`, `App.css` and per-component CSS. Fonts: only Google font Martel (400, 700) is loaded (from `fonts.googleapis.com`). CSS references 'Derivia Regular' and 'tenderness-regular' but there is no `@font-face` anywhere, so those headings silently fall back to `sans-serif` (the intended brand fonts never load). Colours are hardcoded hex values (`#464646`, `#fAfAfA`, `#F3F5F5`, button `rgba(227,204,180)`); no design tokens. Icons from inline SVG; `bootstrap-icons` is a dependency.

## 4. Texts

All page texts are hardcoded in components (scope note from Adam: texts stay in code). Czech, with some typos.

`src/data/Translations.ts` (3 exports, despite the name it is not an i18n table):
- `KnowMore = "ZOBRAZIT VÍC"`
- `InstagramUrl = "https://www.instagram.com/mullny_photos/?hl=cs"`
- `MailUrl = "mailto: mullnyphotos@gmail.com"` (note: space after `mailto:`)

`src/data/DataTexts.ts`: type `Review { gallery, description }` and two reviews: `PatiReview` (gallery `pati`, about Terka's shooting, ~420 chars) and `AnezReview` (gallery `anez`, ~430 chars). Both use backslash line continuation inside a string, which embeds runs of spaces in the rendered text.

Texts that live elsewhere (to be migrated into the new code-based page texts):
- `pages/Home.tsx`: "KATEGORIE", category titles SVATBY / PORTRÉTY / PÁROVÉ FOCENÍ
- `components/home/HelloView.tsx`: title "Vítejte na mé stránce" and two paragraphs (photographer Terezie Müllnerová, Brno, portrait, couples and wedding photography)
- `components/home/PhotoCollage.tsx`: one quote paragraph about memories
- `components/home/Experience.tsx`: "RECENZE"
- `pages/About.tsx`: three blocks "O MNĚ", "MÉ ZKUŠENOSTI" (claims 46 000 portrait, 12 000 wedding, 4 000 product photos), "MŮJ PŘIBĚH" (typo/lowercase sentence starts)
- `pages/Contact.tsx`: "KONTAKT" and "INSTAGRAM" blocks (typos: "Pavidelne"), button labels `mullnyphotos@gmail.com`, `@mullny_photos`
- `components/NavMenu.tsx`: Úvod, Portfolio, - Svatby, - Portréty, - Párové focení, O mně, Kontakt
- `components/BottomBar.tsx`: "MULLNY", "Fotím v Jihomoravskom kraji", MyWed title
- `public/index.html` / `manifest.json`: "Mullny photos", "Focení svateb, portrétu a párových fotek" (sic, "portrétů")
- `pages/NotFound.tsx`: English placeholder (unused)

Person/business facts visible in texts: Terezie Müllnerová ("Terka"), photographer in Brno / South Moravian region; weddings, portraits, couples, products; mail `mullnyphotos@gmail.com`; Instagram `mullny_photos`; MyWed profile `mullny`.

## 5. Gallery list (`src/data/Data.ts`)

Enum `Category`: `weddings`, `couples`, `portraits`. Type `Gallery { id, placeName, nameOfGallery, type, numOfImages, mainImgNum }`. 13 albums in `allGalleries`, order shown. Only `placeName` set is `lucka_filip` = "Brno".

| # | id | Name | Category | numOfImages | mainImgNum | Files on disk | Match |
|---|---|---|---|---|---|---|---|
| 1 | frankovi | Michal & Rozárka | weddings | 5 | 1 | 5 | yes |
| 2 | hradsti | Jitka & Tomáš | weddings | 8 | 2 | 8 | yes |
| 3 | sedlakovi | Adam & Eliška | weddings | 44 | 42 | 44 | yes |
| 4 | suranovi | Broňa a Prokop | weddings | 5 | 1 | 5 | yes |
| 5 | anez | Anež | portraits | 9 | 9 | 9 | yes |
| 6 | lucka | Lucka | portraits | 5 | 1 | 5 | yes |
| 7 | lukas | Lukáš | portraits | 7 | 1 | 7 | yes |
| 8 | mia | Mia | portraits | 20 | 1 | 20 | yes |
| 9 | pati | Pati | portraits | 12 | 5 | 12 | yes |
| 10 | pati2 | Pati kavárna | portraits | 4 | 1 | 4 | yes |
| 11 | pavla_rafael | Pavla & Rafael | couples | 11 | 1 | 11 | yes |
| 12 | helis_tom | Helis & Tom | couples | 6 | 1 | 6 | yes |
| 13 | lucka_filip | Lucka & Filip | couples | 5 | 1 | 5 | yes |

Image counts match `numOfImages` for all 13 albums; no differences. Every `mainImgNum` is within range, and files are numbered `1.jpg`..`N.jpg` without gaps. Totals: 4 wedding albums (62 photos), 6 portrait albums (57), 3 couple albums (22) = 141 album photos. Note `allGalleries` order is not grouped identically to the page order (portraits listed before couples; pavla_rafael before helis_tom), which is also the on-page order. Only `weddings` albums have their own page; `lucka`, `lukas`, `mia`, `pati2`, `pavla_rafael`, `helis_tom`, `lucka_filip` are only seen within the category page. Photo order = file number. Photos have no captions or alt text; placeName is mostly empty.

## 6. Images under `public/fotky_web`

Generated with `node scripts/audit-images.mjs` (Node built-ins only, reads JPEG SOF / PNG IHDR headers; prints a per-album summary and a per-file table with pixel size and size in KB; ignores `.DS_Store`). Re-run it for the full per-file list. Totals: 163 files, 140.94 MB.

Per album (galleries):

| album dir | files | total MB | avg KB | max KB | min px (WxH) | max px (WxH) |
|---|---|---|---|---|---|---|
| galleries/couples/helis_tom | 6 | 5.93 | 1011 | 1019 | 1053x1578 | 1962x2941 |
| galleries/couples/lucka_filip | 5 | 4.90 | 1004 | 1014 | 1135x1701 | 1593x2388 |
| galleries/couples/pavla_rafael | 11 | 10.80 | 1005 | 1022 | 1362x1128 | 2530x2131 |
| galleries/portraits/anez | 9 | 8.80 | 1001 | 1022 | 1351x1522 | 2404x2453 |
| galleries/portraits/lucka | 5 | 4.91 | 1005 | 1016 | 2292x1530 | 3162x2109 |
| galleries/portraits/lukas | 7 | 6.83 | 999 | 1009 | 1146x1718 | 1468x2201 |
| galleries/portraits/mia | 20 | 19.52 | 999 | 1013 | 1313x1179 | 2298x2858 |
| galleries/portraits/pati | 12 | 11.86 | 1012 | 1019 | 1195x1447 | 2169x2301 |
| galleries/portraits/pati2 | 4 | 3.90 | 998 | 1013 | 1666x2497 | 1727x2588 |
| galleries/weddings/frankovi | 5 | 4.93 | 1009 | 1021 | 1480x987 | 2381x1589 |
| galleries/weddings/hradsti | 8 | 7.83 | 1002 | 1019 | 1499x1240 | 3089x2352 |
| galleries/weddings/sedlakovi | 44 | 29.36 | 683 | 699 | 964x992 | 3149x3055 |
| galleries/weddings/suranovi | 5 | 4.93 | 1009 | 1019 | 1899x1267 | 2398x2863 |

Site images (every file):

| file | px (WxH) | KB | used by |
|---|---|---|---|
| site/home/main.jpg | 2640x1761 | 1013 | Home hero (alt empty) |
| site/home/hello.jpg | 1777x2091 | 1000 | HelloView |
| site/home/hello2.jpg | 1574x2360 | 996 | unused in code |
| site/home/weddings.jpg | 1739x2606 | 998 | category card |
| site/home/portraits.jpg | 1671x2504 | 994 | category card |
| site/home/couples.jpg | 1460x2188 | 1002 | category card |
| site/home/trio1.jpg | 2395x1598 | 997 | PhotoCollage |
| site/home/trio2.jpg | 1542x2312 | 1006 | PhotoCollage |
| site/home/trio3.jpg | 1508x2260 | 1001 | PhotoCollage |
| site/about/main_about.jpg | 2269x1514 | 996 | About hero |
| site/about/nature.jpg | 1570x1680 | 990 | About |
| site/about/wedding.jpg | 1798x1979 | 997 | About |
| site/about/cake.jpg | 1769x1621 | 1009 | About |
| site/contact/main_contact.jpg | 2624x1750 | 1004 | Contact hero |
| site/contact/contact.jpg | 1835x1225 | 998 | Contact |
| site/contact/instagram.png | 865x867 | 1000 | Contact (a PNG of ~1 MB) |
| site/common/main_logo_2.png | 301x119 | 14 | header logo |
| site/common/main_logo.png | 323x240 | 18 | unused |
| site/common/favicon.ico | n/a | 19 | unused (root `public/favicon.ico` is the one linked) |
| site/preview/preview.jpg | 2582x1723 | 683 | OG / Twitter image |
| site/preview/logo.png | 3840x3316 | 87 | unused |
| site/preview/logo2.png | 512x512 | 32 | unused |

Observations:
- Every file is a full-size JPEG compressed to just under 1 MB (about 1000 KB for nearly all; `sedlakovi` about 685 KB). Pixel sizes range 964 to 3162 px; most are 1500 to 2500 px on the long side. There are no thumbnails or responsive variants: a category page loads every photo at full size (`/portraits` = 57 photos, about 56 MB; `sedlakovi` = 29 MB; the 3 category cards on Home each load a 1 MB image displayed at about 240x320 px).
- No `width`/`height` attributes, no `loading="lazy"`, no `srcset`, no modern formats (WebP/AVIF). No image optimisation step in the build.
- `public/` root also has `logo.png`, `android-chrome-192x192.png`, `favicon.ico` (not covered by the script, outside `fotky_web`).
- The whole `public/fotky_web` is 141 MB, and the committed `build/fotky_web` duplicates a (partly stale) copy.
- Photo originals are not stored in the repo: only these recompressed ones exist (README: bulk resized with redketchup.io).
- These 5 site assets are unused by code: `hello2.jpg`, `main_logo.png`, `site/common/favicon.ico`, `preview/logo.png`, `preview/logo2.png` are unused by code.

## 7. Analytics setup

GA4 measurement id `G-7QEZCZ09WY` and GTM container `GTM-5XB7XDT` are loaded three ways at once, all before any consent:

1. Hardcoded gtag.js in `public/index.html`: `<script async src="https://www.googletagmanager.com/gtag/js?id=G-7QEZCZ09WY">` plus inline `gtag('config','G-7QEZCZ09WY')`. Fires a page view on load.
2. `src/index.tsx`: `ReactGA.initialize("G-7QEZCZ09WY")` (react-ga4 loads gtag.js again and configures the same id).
3. Google Tag Manager snippet (`GTM-5XB7XDT`) in `<head>` plus `<noscript><iframe>` inside `<head>` (the noscript iframe belongs in `<body>`; in `<head>` it is invalid). What the container fires is unknown (H-4).

Custom events (`src/data/AnalyticsHandler.ts`): `pushAnalysisEvent(category, action)` is called in every page's `useEffect` with `AnalyticAction.PAGE` ("PageLoad") and a pageId (home, portfolio, weddings, showcase, about, contact, not_found). Enum also has `COMPONENT` and `LINK`, never used. `pushAnalysisPageChange` starts with `return;` (turned off in commit 1a92120), so manual SPA page views are not sent; `console.log` and `ReactGA.send` after it are dead code. Because the hash route does not change the real path, GA4 enhanced measurement may record page changes through history events, so double counting between gtag config, react-ga4 and GTM is likely (to be analysed in T-5).

No consent banner, no cookie or privacy page, no consent mode. No click events for Instagram / mail. `reportWebVitals()` is called without a handler (does nothing).

## 8. SEO state

- `<html lang="cz">`: wrong; Czech is `cs`.
- `<title>Mullny photos</title>` (static), changed client-side by `usePageTitle` to "<Page> | MullnyPhotos". All gallery pages share the title "Fotogalerie".
- `<meta name="title">` and `<meta name="description" content="Focení svateb, portrétu a párových fotek">` (one description for the whole site, typo "portrétu").
- Open Graph: `og:type=profile`, `og:url`, `og:title`, `og:description`, `og:image` all point to `https://asdsasm9.github.io/mp_page/...` (old GitHub Pages URL, not the custom domain). No `og:site_name`, `og:locale`, no image dimensions. Twitter card summary_large_image with the same stale URLs. `og:image` is preview.jpg 2582x1723, 683 KB.
- No `<link rel="canonical">`.
- `robots.txt`: `User-agent: *` / `Disallow:` (allows everything), no `Sitemap:` line.
- No `sitemap.xml`. No structured data (no JSON-LD / microdata).
- Hash routing means search engines see a single URL; per-page title and description are not available without running JS, and `#/` fragments are not indexed separately.
- Content is rendered client-side only (CRA, no prerender); `<noscript>` text is English "You need to enable JavaScript to run this app."
- Images have no useful alt text (see section 9).
- No custom 404 page (GitHub Pages default; `NotFound.tsx` is unused and the router redirects unknown hash routes).
- Fonts loaded from Google Fonts (third-party request, GDPR note for T-3/T-5); `preconnect` missing.
- `manifest.json`: short_name "Mullny photos", name "Focení svateb, portrétu a párových fotek", `start_url "."`, `display standalone`, icons listed as `logo.png` both at 192 and 512 (same file, size claims unverified), theme colour `#ffffff`. `public/index.html` apple-touch-icon points to `favicon.ico` instead of a PNG.

## 9. Accessibility gaps

- `lang="cz"` is not a valid language code (should be `cs`); screen readers pick the wrong voice.
- Navigation items and category cards are `<button>`/`<div onClick>` instead of links: not keyboard-focusable as links (div cards are not focusable at all), no middle-click or open-in-new-tab, no `aria-current`.
- Portfolio dropdown opens on mouse hover only (`.dropdown:hover`), not on keyboard focus or touch; there is no `aria-expanded` or `aria-haspopup`.
- Mobile menu toggle button has no accessible name (icon-only SVG, no `aria-label`, no `aria-expanded`/`aria-controls`).
- No skip link, no `<main>` landmark (only `header`, `nav`, `footer`), headings are mostly `<p>` elements; only the wedding list uses `<h1>` (one per row), no real heading structure on other pages.
- Images: header logo has no `alt`; hero images `alt=""` (fine if decorative, but unlabelled); many `alt="Image"` / `alt="Photo n"` (redundant, meaningless); gallery photos use the file path as alt (`fotky_web/galleries/...`); category cards use the title.
- Custom fonts do not load; body text is 13 px with 23 px line height, 14 px review text; contrast of `#464646` on white is fine, but the nav sits transparent over a hero image before scrolling (no guaranteed contrast).
- Text is `text-align: justify` on small screens (hard to read).
- External links open in a new tab (`target="_blank"`) with no `rel` and no warning; the MyWed badge image has fixed 70x50 dimensions.
- No visible focus styles defined; Tailwind preflight resets are not replaced.
- Layout uses fixed `h-80 w-60` / `xl:h-96 xl:w-72` for cards and `vw` sized images; not tested for zoom/reflow at 400%.
- Footer mail link is an icon-only SVG with no accessible name (same for the Instagram icon link).
- Console logs and a client-side crash on an unknown wedding id (see routes) leave a blank page without any message.
- Wrong or mixed language: "Jihomoravskom" (Slovak), English `NotFound`, `noscript`.

## 10. Committed `build/` folder

- About 130 files are tracked in git under `build/` (confirmed with `git ls-files build`), even though `.gitignore` contains `/build` (it was committed before the ignore rule). The old `deploy` script (gh-pages) publishes `build/` to the `gh-pages` branch, so the tracked folder is not what is live.
- The tracked copy is a stale and incomplete build: `build/index.html` references `/static/js/main.2d0f0e1b.js` and `/static/css/main.37097705.css`, but those two files are not tracked (only the `787` chunk and its map are). It also lacks `favicon.ico`, `CNAME`, `logo.png`, `android-chrome-192x192.png`, `site/common/*`, `site/preview/logo*.png` and `sedlakovi/14..44.jpg` (it only holds `sedlakovi` 1 to 13). The tracked copy also still has its old meta tags.
- A fresh build produces a different bundle hash (`main.4ef3f3d5.js`), so the tracked build is out of date with the source.
- `.DS_Store` files are also tracked inside `build/`.
- Recommendation for the rebuild: remove `build/` from git (`git rm -r --cached build`) in a later task, keep the `/build` ignore rule. Not done here (task says do not delete anything else).
- Ignored leftovers from the audit's own `npm run build` still sit in `build/` (new files: `static/js/main.4ef3f3d5.js*`, `static/css/*`, `CNAME`, `favicon.ico`, `logo.png`, `android-chrome-192x192.png`, `fotky_web/site/common/`, `sedlakovi/14..44.jpg`, `preview/logo*.png`). `git clean -fd build` was denied, and `-fd` would not remove ignored files anyway (it needs `-x`). They do not appear in `git status`. Safe for a human to remove with `git clean -fdx build`.

## 11. Other findings

- `package.json`: `private: false`, name `mp_page`; deploy via `gh-pages` devDependency; CRA is unmaintained (react-scripts 5.0.1, TypeScript 4.9), which explains the 104 audit findings.
- `.gitattributes` and `.gitignore` present; `/build` ignored but tracked (above).
- `README.md` is minimal: hosting on GitHub Pages at `https://www.mullnyphotos.cz`, image resizing tool, the old `deploy` script.
- No tests exist (`setupTests.ts` only); `npm test` has nothing to run.
- Third-party requests at load: Google Fonts, googletagmanager.com (twice via gtag and GTM), mywed.com logo.
- DNS: the domain points to GitHub Pages (CNAME `www.mullnyphotos.cz`); see backlog H-5.
