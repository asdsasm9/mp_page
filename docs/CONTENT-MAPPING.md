# Content and migration mapping (T-2)

Date: 2026-10-19. Inputs: `docs/AUDIT.md` (T-1), `VISION.md`, the legacy `src/data/Data.ts`. Scope note (Adam, 2026-10-19): page texts stay in code, so there is **no `pages` table**. The database holds only categories, albums and photos.

## 1. What goes where

| Legacy content | Target |
|---|---|
| `Category` enum (3 values) | `categories` rows (section 3) |
| `allGalleries` (13 entries) | `albums` rows (section 4) |
| `public/fotky_web/galleries/<cat>/<id>/<n>.jpg` (141 files) | `photos` rows plus R2 objects (sections 5 and 6) |
| `site/*` images (home, about, contact, common, preview: 22 files, 6 unused) | NOT in the database. Page assets stay in code and are optimised at build time. The 5 unused files are dropped (`hello2.jpg`, `main_logo.png`, `site/common/favicon.ico`, `preview/logo.png`, `preview/logo2.png`). |
| `Translations.ts`, `DataTexts.ts` (reviews), all component texts | Stay in code (new page texts). The two reviews keep referencing album slugs `pati` and `anez`; the review image is that album's cover, read from the DB at build time. |
| `usePageTitle` titles, meta tags | Code, per page type (spec in T-3 `docs/SEO.md`). Album SEO title/description come from album columns. |

## 2. Proposed tables (only the columns that matter for the mapping)

```
categories(id uuid pk, slug text unique, name text, description text null,
           seo_title text null, seo_description text null,
           sort int, visible bool default true)

albums(id uuid pk, category_id fk, slug text,            -- unique (category_id, slug); also globally unique, see below
       title text, place text null, shot_on date null,
       description text null, seo_title text null, seo_description text null,
       cover_photo_id uuid null fk photos(id),
       sort int, published bool default false,
       legacy_id text unique null)                       -- the old id, kept for the redirect/migration

photos(id uuid pk, album_id fk, storage_key text unique,  -- original, see section 6
       width int, height int, bytes_total bigint,        -- bytes_total = original + all variants (T-6 quota)
       blurhash text null, alt text null, caption text null,
       sort int,
       legacy_key text unique null)                      -- '<category>/<album>/<n>.jpg', idempotency key
```

Slugs: album slugs are unique across the whole site (not only per category), because the old URLs and the redirect script identify an album by its id alone. Reserved slugs that cannot be used for an album: none needed in the path scheme below (albums always sit under a category).

## 3. Categories (3)

Order follows the current navigation (Svatby, Portréty, Párové focení), not `Data.ts` enum order.

| sort | legacy `Category` | name (cs) | slug (new) | albums |
|---|---|---|---|---|
| 10 | `weddings` | Svatby | `svatby` | 4 |
| 20 | `portraits` | Portréty | `portrety` | 6 |
| 30 | `couples` | Párové focení | `parove-foceni` | 3 |

Open question Q1 (low stakes): category slugs are proposed in Czech for local SEO (`/svatby/` rather than `/weddings/`). Album slugs keep the old ids exactly as the VISION asks. If the owner prefers English category paths, only this table and the redirect table change. `description`, `seo_*`: empty at migration, to be filled with T-3 wording. All 3 are `visible = true`.

## 4. Albums (13)

`sort` is the position inside its category (legacy order on the page). Cover = `mainImgNum`: the album's `cover_photo_id` points at the photo whose legacy file number equals `mainImgNum` (so `cover_photo_id` = the photo with `legacy_key = '<cat>/<id>/<mainImgNum>.jpg'`). All albums migrate as `published = true` (they are live today). `shot_on`, `description`, `seo_*` are null.

| # | legacy id = slug | category | title | place | photos | cover (mainImgNum) | sort in category |
|---|---|---|---|---|---|---|---|
| 1 | frankovi | svatby | Michal & Rozárka | null | 5 | 1 | 10 |
| 2 | hradsti | svatby | Jitka & Tomáš | null | 8 | 2 | 20 |
| 3 | sedlakovi | svatby | Adam & Eliška | null | 44 | 42 | 30 |
| 4 | suranovi | svatby | Broňa a Prokop | null | 5 | 1 | 40 |
| 5 | anez | portrety | Anež | null | 9 | 9 | 10 |
| 6 | lucka | portrety | Lucka | null | 5 | 1 | 20 |
| 7 | lukas | portrety | Lukáš | null | 7 | 1 | 30 |
| 8 | mia | portrety | Mia | null | 20 | 1 | 40 |
| 9 | pati | portrety | Pati | null | 12 | 5 | 50 |
| 10 | pati2 | portrety | Pati kavárna | null | 4 | 1 | 60 |
| 11 | pavla_rafael | parove-foceni | Pavla & Rafael | null | 11 | 1 | 10 |
| 12 | helis_tom | parove-foceni | Helis & Tom | null | 6 | 1 | 20 |
| 13 | lucka_filip | parove-foceni | Lucka & Filip | Brno | 5 | 1 | 30 |

Totals: 13 albums, 3 categories, 141 photos (62 + 57 + 22), matching AUDIT section 5.

Slug note: `pavla_rafael`, `helis_tom`, `lucka_filip` contain underscores. The brief says keep the current ids, so the migration keeps them as-is and old links stay recognisable. Underscores are less ideal for SEO than hyphens (Q2: optionally rename to `pavla-rafael` etc.; if the owner agrees, the redirect table gets the hyphenated target and `legacy_id` keeps the underscore form. Default in this document: keep the underscores.) The admin slug field accepts `a-z 0-9 - _` for migrated rows and proposes hyphens for new albums.

Fields that cannot be derived from the old data (alt text, captions, dates, descriptions, SEO text) are left empty and are filled in the admin or by T-3 rules (default alt pattern generated at render time, e.g. "<album title>, fotografie <n>", is specified in `docs/SEO.md`).

## 5. Photos and order

One `photos` row per legacy file `public/fotky_web/galleries/<cat>/<id>/<n>.jpg`, n = 1..numOfImages (all counts verified against disk in AUDIT).

- `sort` = n (display order = file number, as today; no gaps).
- `legacy_key` = `<cat>/<id>/<n>.jpg` using the legacy category (`weddings`, `portraits`, `couples`), e.g. `weddings/sedlakovi/42.jpg`. Unique, so a second migration run finds the row and skips it (idempotent; report counts per album: found, inserted, skipped).
- `width`, `height` read from the file at migration (AUDIT lists the ranges 964 to 3162 px).
- `alt`, `caption` = null.
- Cover: after all photos of an album exist, set `albums.cover_photo_id` from `mainImgNum`. A missing cover (none today) falls back to the photo with the lowest `sort` at render time.
- The legacy files are the only copies (already recompressed, nothing larger exists, see AUDIT section 6). They are therefore both the "original" and the source for variants.

## 6. Storage key scheme (R2 bucket `mullnyphotos`)

Keys are based on the photo id, never on album or category, so moving a photo between albums, renaming slugs and reordering never touch R2.

```
photos/<photo_id>/original.<ext>        the uploaded file as is (migration: the legacy jpg)
photos/<photo_id>/<w>.avif              variant, w in {480, 960, 1600, 2400}
photos/<photo_id>/<w>.webp
photos/<photo_id>/<w>.jpg               JPEG fallback
```

- `<photo_id>` is the `photos.id` UUID (lowercase). `photos.storage_key` stores the `original` key; variant keys are derived from it by the shared helper (`packages/shared`), so there is one place that knows the scheme.
- Variants wider than the source are skipped (no upscaling): the widest variant is the largest listed width not exceeding the source width; sources under 480 px get only their own size.
- All objects are immutable (new upload = new photo id), so public URLs get `Cache-Control: public, max-age=31536000, immutable`.
- Public URL = `<PUBLIC_BASE_URL>/<key>` (`img.mullnyphotos.cz`, waits for H-5).
- `photos.bytes_total` sums the original plus every variant; this feeds the T-6 quota guard.
- Delete a photo = delete all keys under `photos/<photo_id>/`.
- Migration idempotency: key lookup is by `photos.legacy_key`; if the row exists the upload step checks the `original` object exists (HEAD) and only re-uploads missing objects.
- Site assets (`site/*`) are not stored in R2 (they ship with the site build).

## 7. Redirects: old URL to new URL

### 7.1 New URL scheme (proposed; owned together with T-3)

| New URL | Page |
|---|---|
| `/` | Home |
| `/portfolio/` | Portfolio (the 3 category cards and reviews) |
| `/svatby/`, `/portrety/`, `/parove-foceni/` | Category page (album list) |
| `/svatby/<slug>/`, `/portrety/<slug>/`, `/parove-foceni/<slug>/` | Album page (every album now has its own page; before only weddings did) |
| `/o-mne/` | About |
| `/kontakt/` | Contact |
| `/404.html` | Not found (real 404 status) |

### 7.2 Hash routes (client side)

A fragment (`#/...`) never reaches the server, so Cloudflare cannot redirect it. The new Home page (`/`) ships a tiny inline script in `<head>` (before first paint, no dependency, around 600 bytes) that reads `location.hash` and calls `location.replace(newPath)`. Because the old site only ever served `/`, every old hash link lands on `/`, which is exactly where the script lives. It does nothing when there is no hash starting with `#/` (and never loads analytics). The static mapping is fixed forever (old routes cannot change), so it is not generated from the database.

Every route from AUDIT section 2:

| Old URL | New URL | Status |
|---|---|---|
| `/` (no hash) | `/` | no redirect |
| `/#/` | `/` | client |
| `/#/home` | `/` | client |
| `/#/portfolio` | `/portfolio/` | client |
| `/#/weddings` | `/svatby/` | client |
| `/#/weddings/frankovi` | `/svatby/frankovi/` | client |
| `/#/weddings/hradsti` | `/svatby/hradsti/` | client |
| `/#/weddings/sedlakovi` | `/svatby/sedlakovi/` | client |
| `/#/weddings/suranovi` | `/svatby/suranovi/` | client |
| `/#/portraits` | `/portrety/` | client |
| `/#/couples` | `/parove-foceni/` | client |
| `/#/about` | `/o-mne/` | client |
| `/#/contact` | `/kontakt/` | client |
| `/#/weddings/<unknown id>` (old app crashed to a blank page) | `/svatby/` | client |
| `/#/<anything else>` (old app redirected to `/#/home`) | `/` | client |

Not routes in the old app but cheap and harmless, so included (people may have guessed or built them): `/#/portraits/<id>` and `/#/couples/<id>` for the 9 non-wedding albums go to their new album page (the 9 portrait and couple albums had no page of their own before):

| Old (never linked) | New |
|---|---|
| `/#/portraits/anez` | `/portrety/anez/` |
| `/#/portraits/lucka` | `/portrety/lucka/` |
| `/#/portraits/lukas` | `/portrety/lukas/` |
| `/#/portraits/mia` | `/portrety/mia/` |
| `/#/portraits/pati` | `/portrety/pati/` |
| `/#/portraits/pati2` | `/portrety/pati2/` |
| `/#/couples/pavla_rafael` | `/parove-foceni/pavla_rafael/` |
| `/#/couples/helis_tom` | `/parove-foceni/helis_tom/` |
| `/#/couples/lucka_filip` | `/parove-foceni/lucka_filip/` |

Reference implementation (to be built and unit tested in the Home page work package; the test feeds every row of the tables above and asserts the target, plus "no hash = no call"):

```js
(function () {
  var h = location.hash;
  if (h.indexOf('#/') !== 0) return;
  var p = h.slice(2).split('?')[0].replace(/\/+$/, '').split('/');
  var cat = { weddings: 'svatby', portraits: 'portrety', couples: 'parove-foceni' };
  var page = { home: '/', '': '/', portfolio: '/portfolio/', about: '/o-mne/', contact: '/kontakt/' };
  var albums = { weddings: ['frankovi','hradsti','sedlakovi','suranovi'],
    portraits: ['anez','lucka','lukas','mia','pati','pati2'],
    couples: ['pavla_rafael','helis_tom','lucka_filip'] };
  var to = '/';
  if (cat[p[0]]) {
    to = '/' + cat[p[0]] + '/';
    if (p[1] && albums[p[0]].indexOf(p[1]) > -1) to += p[1] + '/';
  } else if (Object.prototype.hasOwnProperty.call(page, p[0]) && !p[1]) {
    to = page[p[0]];
  }
  location.replace(to);
})();
```

Behaviour notes: `replace`, not `assign`, so Back does not loop; the unknown-id rule falls out of the album check (goes to the category). If the owner later renames an album slug, the new site's own slug-history is not needed here because the old hash routes only know the 13 original ids; later renames are handled by T-3/admin work (Q3: do we keep a `slug_history` table for renamed albums? Proposed: yes, small, but not part of v1 unless the photographer renames a published album).

### 7.3 Real path redirects (server side, Cloudflare)

Delivered as a `_redirects` file (or Cloudflare redirect rules) in the public site build. 301 = permanent.

| Old path (host `www.mullnyphotos.cz`) | New | Code | Why |
|---|---|---|---|
| `/index.html` | `/` | 301 | old entry file |
| `/home`, `/home/` | `/` | 301 | in case of a path-style link |
| `/portfolio` | `/portfolio/` | 301 | trailing slash normalisation |
| `/weddings`, `/weddings/` | `/svatby/` | 301 | path-style guess of the old hash route |
| `/weddings/:id` (4 ids) | `/svatby/:id/` | 301 | same |
| `/portraits`, `/portraits/` | `/portrety/` | 301 | same |
| `/portraits/:id` | `/portrety/:id/` | 301 | same |
| `/couples`, `/couples/` | `/parove-foceni/` | 301 | same |
| `/couples/:id` | `/parove-foceni/:id/` | 301 | same |
| `/about`, `/about/` | `/o-mne/` | 301 | same |
| `/contact`, `/contact/` | `/kontakt/` | 301 | same |
| `/fotky_web/galleries/<cat>/<id>/<n>.jpg` (141 URLs) | `<PUBLIC_BASE_URL>/photos/<photo_id>/1600.jpg` | 301 | Google Images and external embeds. Generated at migration time from `legacy_key` to `photo_id` into a `_redirects` file (141 lines; Cloudflare Pages allows 2000 static rules), so the old image URLs keep working. The 1600 px variant is the closest to the old "about 1 MB" files. |
| `/fotky_web/site/preview/preview.jpg` | the new OG image URL (T-3 picks it) | 301 | social share caches |
| `/fotky_web/site/**` (other site images) | no redirect, 410 or 404 | n/a | not indexed assets; accepted loss |
| `/robots.txt`, `/manifest.json`, `/favicon.ico`, `/logo.png`, `/android-chrome-192x192.png` | same path, served by the new site (new files with the same names) | none | root files, must exist at the same path |
| `/CNAME` | not served | n/a | GitHub Pages artefact |
| anything else | `/404.html` with status 404 | 404 | real not found page (the old site had a soft redirect to home) |

Both `weddings` etc. rows are only guesses of path-style links (the old site never served them as paths) and cost nothing. The `/fotky_web/...` image redirects reference R2 public URLs, so they are only generated and switched on after H-5 (DNS on Cloudflare plus `img.mullnyphotos.cz` connected).

### 7.4 Other legacy host

`https://asdsasm9.github.io/mp_page/...` (hardcoded in the old `og:url`, `og:image`, `twitter:*`). Server-side redirects from `github.io` are not possible from the new Cloudflare project. Plan:

1. After cutover, GitHub Pages for the old repo keeps serving until the human turns it off. GitHub Pages with a custom domain set normally redirects the `github.io/mp_page/` project URL to the custom domain automatically (UNVERIFIED, the audit had no network access; a human check after cutover).
2. If the old `github.io` URLs still resolve and do not redirect, put the same hash script (section 7.2) into a one-page `index.html` and a `404.html` on the old `gh-pages` branch whose final `location.replace` target is `https://www.mullnyphotos.cz` plus the mapped path, so `/mp_page/#/weddings/frankovi` goes to `https://www.mullnyphotos.cz/svatby/frankovi/`, and `/mp_page/fotky_web/...` goes to the home page. That is a human step in the cutover checklist (the old repo is not touched before cutover).
3. Social shares that cached the old `og:image` URL are not recoverable; no action.

### 7.5 After cutover (human checklist feed)

- Resubmit `sitemap.xml` in Search Console (the old indexed URL was just `/`).
- Test with a handful of old links: `/#/weddings/frankovi`, `/#/portraits`, `/#/couples`, `/#/about`, `/#/contact`, `/#/home`, `/#/nonsense`.

## 8. Acceptance check

- 3 of 3 categories mapped (section 3); 13 of 13 albums mapped with slug, category, title, place, cover and order (section 4); photo order, keys and migration keys defined (sections 5 and 6).
- Every route of AUDIT section 2 has a target in section 7.2 (the 13 route rows, including `/`, `/#/`, the wildcard and the unknown-wedding case) and the legacy `github.io` host in section 7.4.
- Open questions for the human: Q1 category slugs in Czech, Q2 underscores in three album slugs, Q3 slug history for renamed albums.
