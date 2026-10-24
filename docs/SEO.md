# SEO and performance spec (T-3)

Date: 2026-10-19. Inputs: VISION.md goal 2 and constraints, the business profile, `docs/AUDIT.md` (sections 2, 5, 6, 8). Czech only. This is a spec, not an implementation. Wording marked **Q-n** needs the photographer's answer (collected in section 11); until she answers, the patterns use the placeholder text shown and the build must not fail on it.

Goal: rank for local searches in Brno and the South Moravian region, and look trustworthy when a link is shared. Capacity is about 5 family shoots and 4 to 5 weddings a year, so the aim is quality of leads, not volume.

## 1. Facts and conventions

- Production origin: `https://www.mullnyphotos.cz` (the `www` host is canonical; the apex redirects to it). The stale `asdsasm9.github.io/mp_page` host must never appear in any tag.
- Business: Mullny Photos, photographer Terezie Müllnerová ("Terka"), Brno. Services seen on the site: svatby, portréty (including těhotenské and rodinné focení, studio or at home), párové focení. Products appear in the About text (46 000 portrait, 12 000 wedding, 4 000 product photos); **Q-1**: does she still offer product photography and should it be a keyword?
- Contact: `mullnyphotos@gmail.com`, Instagram `mullny_photos`, MyWed profile `https://mywed.com/cs/photographer/mullny/`. **Q-2**: phone number to publish (or none)? Gmail address is fine for contact but a phone is a stronger local signal.
- Brand string: `Mullny Photos` (audit shows `MullnyPhotos` and `Mullny photos` both in use; use `Mullny Photos` everywhere; **Q-3** confirm the spelling).
- Language: `<html lang="cs">`, `og:locale` `cs_CZ`. Single language, no hreflang.
- `/portfolio/` is a real page (T-95, D-6): all categories plus a selection of up to 9 albums (first album per category first). There is no `/portfolio` -> `/` redirect; the legacy hash mapping `#/portfolio` -> `/portfolio/` belongs to T-65/T-66.
- URL scheme (final slugs come from T-2): `/`, `/portfolio/`, `/svatby/`, `/portrety/`, `/parove-foceni/`, `/svatby/<album-slug>/`, `/o-mne/`, `/cookies/`. "Kontakt" is a section of the home page (`/#kontakt`), not a page; the old `/kontakt/` URL was removed (WP-12). `/o-mne/` is a real page again (T-293; WP-12 had folded it into Home). Trailing slash, lowercase, ASCII, hyphens. Category slugs are editable in the admin, so the sitemap, canonicals and breadcrumbs are always derived from the stored slug, never hardcoded.
- Every page is real prerendered HTML containing its title, description, canonical, OG and JSON-LD in the served document (no client-side injection), so crawlers need no JavaScript.

## 2. Title and description patterns

Rules for all pages:
- Title: 50 to 60 characters (hard ceiling 65), unique per URL, the page topic first, brand last, separator ` | `. The brand is not repeated twice.
- Description: 120 to 155 characters, one or two plain sentences, includes the topic, "Brno" where true, and a soft call to action. No keyword lists, no quotation marks that break the attribute.
- Values come from code for fixed pages and from the database for categories and albums. A build check fails if a title or description is empty, duplicated across URLs, or over the hard limits (title 65, description 160).
- Placeholders in braces; `{place}` appears only when set.

| Page type | Title pattern | Description pattern |
|---|---|---|
| Home `/` | `Fotograf Brno: svatby, portréty, páry \| Mullny Photos` (53) | `Svatební, portrétní a párový fotograf z Brna. Přirozené fotografie plné emocí, focení v Brně a Jihomoravském kraji. Napište mi o termínu.` (about 138) |
| Category `/svatby/` | `Svatební fotograf Brno – svatby \| Mullny Photos` | `Ukázky svatebních fotografií z Brna a okolí. Reportážní focení svatebního dne od příprav po první tanec. Prohlédněte si {count} svateb.` |
| Category `/portrety/` | `Portrétní focení Brno – portréty a rodiny \| Mullny Photos` | `Portréty, rodinné a těhotenské focení v Brně, ve studiu nebo u vás doma. Prohlédněte si ukázky mých fotografií.` |
| Category `/parove-foceni/` | `Párové focení Brno – fotky pro páry \| Mullny Photos` | `Párové a zásnubní focení v Brně a okolí. Uvolněné fotografie, které vás vystihují. Prohlédněte si ukázky.` |
| Album `/<kat>/<album>/` | `{album title}{ – {place}} – {category singular} \| Mullny Photos` (e.g. `Adam & Eliška – svatba \| Mullny Photos`) | The album's SEO text field if filled; otherwise `{Category singular} {album title}{ v místě {place}}. {n} fotografií z focení v Brně a okolí od fotografky Mullny Photos.` |
| Portfolio `/portfolio/` (human decision D-6: a real page listing all categories and a selection of albums) | `Portfolio – svatby, portréty a páry v Brně \| Mullny Photos` | `Portfolio fotografky z Brna: ukázky svateb, portrétů a párového focení. Prohlédněte si všechny kategorie a výběr mých alb.` |
| Cookies `/cookies/` | `Zásady cookies a ochrany soukromí \| Mullny Photos` | `Zásady používání cookies a ochrany osobních údajů na webu Mullny Photos. Zjistěte, jaké údaje web zpracovává a proč.` |
| About | `O mně – fotografka Terezie Müllnerová, Brno` (`aboutMeta`, `/o-mne/`, T-293) | `Jsem Terezie Müllnerová, fotografka z Brna. Specializuji se na svatby, portréty a párové focení. Přečtěte si můj příběh a zkušenosti.` |
| Contact | no page of its own: section `#kontakt` of Home, covered by the Home title and description (`/kontakt/` removed, WP-12) | n/a |
| 404 | `Stránka nenalezena \| Mullny Photos` | none (noindex) |

Keywords come from the services above: svatební fotograf Brno, portrétní focení Brno, rodinné focení Brno, těhotenské focení, párové focení, Jihomoravský kraj. They go into titles, H1s and body text naturally; no `meta keywords`.

Questions:
- **Q-4**: Does she say "fotograf" or "fotografka" about herself, and which of these does she want to be found by: svatební fotograf(ka), rodinné focení, těhotenské focení, focení v ateliéru / doma? Patterns above use "fotograf" in titles (the search term people type) and "fotografka" in prose.
- **Q-5**: Are weddings abroad or outside South Moravia accepted? If yes, "Brno a okolí" in descriptions may be widened to "celá ČR".
- **Q-6**: Does she want to name her style ("přirozené", "reportážní") in the home and wedding descriptions, and in what words? The placeholder wording above was written by us, not by her.
- **Q-7**: Opening hours are not needed; skip them unless she wants them listed.

Headings: exactly one `<h1>` per page. Home: "Fotograf Brno" style line is the hero tagline (**Q-6**, her wording). Category: category name. Album: album title. About: "O mně" (h1, via PageHead). "Kontakt" is an `<h2>` section of Home, and so is the short "O mně" hello. Album pages carry a visible one-paragraph description when the SEO text exists (text on the page, not only in meta).

## 3. Open Graph and Twitter

Tags on every indexable page: `og:type`, `og:site_name` = `Mullny Photos`, `og:locale` = `cs_CZ`, `og:title` (= the title without the brand suffix), `og:description` (= meta description), `og:url` (= canonical), `og:image` (absolute URL), `og:image:secure_url` (the same https URL), `og:image:type` (`image/jpeg`, T-322), `og:image:width`, `og:image:height`, `og:image:alt`, `twitter:card` = `summary_large_image`.

`og:type`: `website` for home, portfolio, categories; `article` is not used (no blog). (The old site used `profile`; drop it.)

OG image choice (1200 x 630 px, JPEG, under 300 KB, generated at upload/build from the source photo with a centre/focal crop; the stored variants carry it so the admin does nothing extra):
- Home: one chosen hero photo (**Q-8**: which photo, ideally one that works when cropped to 1.91:1). Fallback: the current `site/preview/preview.jpg` (2582 x 1723) cropped.
- Category: the category's cover image (first photo of its first visible album, or the category cover if the admin sets one).
- Album: the album's cover photo.
- About (`/o-mne/`) uses the bundled wedding photo as its OG image; Contact has no page of its own, so no OG image (**Q-9**: is she comfortable having her portrait used as a preview image or in `Person` markup?).
- 404 and any page without an image: the home OG image.
- `og:image:alt`: the photo's alt text (section 8).
- Never use a logo as the OG image (the old `preview/logo*.png` files are not used).

## 4. Canonical rules

- Every indexable page has exactly one `<link rel="canonical">` with the absolute `https://www.mullnyphotos.cz/...` URL, trailing slash, no query string, no fragment, self-referencing.
- Build produces one URL per content item: an album is canonical under its own category only. If an album is moved to another category in the admin, the old URL 301-redirects to the new one (redirect table is maintained by the publish step; see T-2 for old-route redirects).
- Query strings (`?utm_*`, `?fbclid`) are ignored by canonical (the tag points to the clean URL).
- Pagination: none planned. Album and category pages are one page each (albums have at most about 45 photos, loaded with lazy loading); no `rel=prev/next`.
- Hidden/unpublished categories and albums return 404 (not a redirect) and are absent from sitemap, navigation, and JSON-LD.
- Staging, preview deployments and the `*.pages.dev` host send `X-Robots-Tag: noindex` (header set per environment) and never appear in canonicals; the canonical is always built from the configured production origin.
- Legacy `asdsasm9.github.io/mp_page` and `#/` URLs: handled by T-2 redirects; after cutover, resubmit the sitemap in Search Console (a human step in the README cutover list).

## 5. Structured data (JSON-LD)

One `<script type="application/ld+json">` per page, built from the same data as the visible page. Content in JSON-LD must match what is visible (no hidden claims). Use absolute URLs. Validate in tests against the required lists below and manually once in the Rich Results Test and the Schema.org validator before cutover.

### 5.1 Photographer (LocalBusiness subtype) on every page

Type `Photographer` (a schema.org subtype of `LocalBusiness`), included as the site entity on Home in full, and as a short `@id` reference elsewhere.

Required by this spec (the union of Google's LocalBusiness requirements and what we can honestly supply):
- `@context`, `@type` = `Photographer`, `@id` = `https://www.mullnyphotos.cz/#business`
- `name` = `Mullny Photos`
- `url` = `https://www.mullnyphotos.cz/`
- `image` (absolute URL to the home OG image)
- `address` as `PostalAddress` with `addressLocality` = `Brno`, `addressRegion` = `Jihomoravský kraj`, `addressCountry` = `CZ`. Google's LocalBusiness rich result formally requires `address`; **Q-10**: does she want a street address and `postalCode` published (studio), or only the city? If only the city, we still output the locality-level address, and the result is not eligible for a map-style rich result, which is acceptable for a home-based service-area business. Never invent a street.
- `areaServed`: `City` Brno and `AdministrativeArea` Jihomoravský kraj
- `email` = `mullnyphotos@gmail.com`
- `sameAs`: `https://www.instagram.com/mullny_photos/`, `https://mywed.com/cs/photographer/mullny/` (plus Facebook if she has a page, **Q-11**)

Optional, only when answered and shown on the page: `telephone` (**Q-2**), `priceRange` (**Q-12**: does she want a price range published? default omit; prices are TBD per the business profile), `openingHoursSpecification` (default omit), `founder`/`employee` as `Person` `Terezie Müllnerová` (on About), `geo` (only with an agreed public location, default omit), `aggregateRating`/`review` (see below).

Do not add `aggregateRating` or `Review` markup for the "RECENZE" texts: they are two quotes tied to albums, not verifiable third-party ratings, and self-serving review markup risks a Google manual action. Show them as plain text.

### 5.2 Person on the About page

`Person` with `@id` `https://www.mullnyphotos.cz/#terezie`, `name` = `Terezie Müllnerová`, `jobTitle` = `Fotografka`, `worksFor` = `{ "@id": ".../#business" }`, `url` = `https://www.mullnyphotos.cz/o-mne/` (emitted on that page together with BreadcrumbList, not on Home; T-293), `image` (portrait; **Q-9**). Required: `@type`, `name`. Only emit with her consent to be named (**Q-13**: public full name OK? It is already on the live site).

### 5.3 ImageGallery on album and category pages

Type `ImageGallery` (schema.org `CollectionPage` subtype) with `ImageObject` items. Google has no rich result for it; it is for clarity and image discovery, so it must stay accurate and small.

Required properties:
- `@context`, `@type` = `ImageGallery`
- `name` (album title or category name)
- `url` (the canonical)
- `description` (the meta description)
- `inLanguage` = `cs`
- `isPartOf`/`about`: `{ "@id": ".../#business" }` as `creator`
- `image` or `hasPart`: array of `ImageObject`, each with required `contentUrl` (absolute URL to the 1600 px variant), `url` or `thumbnailUrl` (480 px variant), `width`, `height` (pixels of that variant), and `caption` or `name` (alt/caption, never the file name). Add `creator` = photographer reference and `copyrightHolder` = Mullny Photos, `license` only if she gives a licence URL (**Q-14**: copyright / "all rights reserved" statement wording and whether she wants `acquireLicensePage` pointing to Contact).
- Cap the array at 20 photos per page (the cover first, then in sort order) to keep the HTML small; photos beyond 20 are still on the page and in the image sitemap.
- Optional: `datePublished`/`dateCreated` from the album's shoot date when set, `contentLocation` = `Place` with `name` = place when set.

On category pages each item is the album cover as an `ImageObject` with `url` pointing to the album page, plus `name` = album title.

### 5.4 BreadcrumbList

On every page except Home. Required: `@type` = `BreadcrumbList`, `itemListElement` with at least two `ListItem`s; each `ListItem` has `position` (1-based, increasing), `name`, and `item` (absolute URL). The last item may omit `item` (Google accepts it) but this spec always includes it for the current page.

| Page | Breadcrumb |
|---|---|
| Category | Úvod > {Category name} |
| Album | Úvod > {Category name} > {Album title} |

The visible breadcrumb on album and category pages (a `<nav aria-label="Drobečková navigace">` with an `<ol>`, the last item `aria-current="page"`) uses the same data. The label of the root is `Úvod` (matches the current nav).

### 5.5 Also on Home: WebSite

`WebSite` with `name`, `url`, `inLanguage`. No `SearchAction` (there is no site search). Required: `@type`, `name`, `url`.

### 5.6 Summary matrix

| Page | Types emitted |
|---|---|
| Home | Photographer (full), WebSite |
| About (`/o-mne/`) | Person, BreadcrumbList |
| Category | ImageGallery, BreadcrumbList, Photographer (reference) |
| Album | ImageGallery, BreadcrumbList, Photographer (reference) |
| 404 | none |

Test: a unit test per type asserts its required properties exist and are non-empty, that URLs are absolute and on the production origin, that `position`s are consecutive, and that no `Review`/`AggregateRating` type is emitted.

## 6. Sitemap and robots

`/sitemap.xml` (generated at build, one file, well under the 50 000 URL / 50 MB limit):
- Lists: home, three categories (only visible ones), the portfolio page, every published album, `/o-mne/`, the cookies page. Excludes 404, hidden/unpublished, and redirect sources.
- Each `<url>`: `<loc>` (canonical form), `<lastmod>` in W3C date format taken from the real last change of the content (album `updated_at`, photos changed, category edit; for fixed pages the build/commit date of that page's source, not "now" on every build). No `changefreq`/`priority` (ignored by Google).
- Images: add the `image` extension (`xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"`) on album URLs with `<image:loc>` for each photo's 1600 px variant and `<image:caption>` from alt text; cap at 1000 images per URL (albums have at most about 45).
- Regenerated on every publish (same deploy hook as the site rebuild).

`/robots.txt`:
```
User-agent: *
Allow: /

Sitemap: https://www.mullnyphotos.cz/sitemap.xml
```
- Production only. Non-production environments serve `User-agent: *` / `Disallow: /` and the `X-Robots-Tag: noindex` header.
- The admin app (`admin.mullnyphotos.cz`) serves `Disallow: /` plus `<meta name="robots" content="noindex, nofollow">` and the same header; it is not in any sitemap.
- Do not block image or CSS/JS paths (the old rule `Disallow:` empty is replaced by the explicit above). Do not block the image CDN host (`img.mullnyphotos.cz`), so Google Images can index the photos.
- After cutover (human step): submit the sitemap in Search Console, check Coverage, verify the old-URL redirects.

Other meta: `<meta name="robots" content="max-image-preview:large">` on all indexable pages (allows large image previews). Utility pages (404) carry `noindex`. The cookie/privacy page (T-5) is indexable and listed in the sitemap, with its own title `Zásady cookies a ochrany soukromí | Mullny Photos`.

## 7. Social and other head tags

`<meta name="viewport" content="width=device-width, initial-scale=1">`, `<meta name="theme-color">` (a design token value, set by the designer), one PNG apple-touch-icon (180 x 180; the old file pointed at the `.ico`), `manifest.webmanifest` fixed (correct 192/512 icons, `name` = `Mullny Photos`, `lang` = `cs`). Fonts: self-hosted, no `fonts.googleapis.com` request (also removes a GDPR-sensitive third-party call), `font-display: swap`, preload only the one or two files used above the fold. The MyWed badge image is self-hosted or replaced by a plain text link (audit: third-party request at load).

## 8. Image alt text rules

Goal: useful to screen readers and image search, never keyword stuffing. Alt is stored per photo (`photos.alt`) and edited in the admin.

1. Describe what is visible in one short sentence, 5 to 15 words, no more than 125 characters. Do not start with "Fotografie" or "Obrázek". No file names, no "IMG", no numbers like `Photo 3`.
2. Add context only when it is true: category, place, the people names she wants shown. Form: `{what is happening}, {who/what}, {place}` e.g. `Nevěsta a ženich se smějí při obřadu na zámku v Lednici`.
3. Default when she leaves it empty (so no photo ships with a bad alt): `{Album title} – {category singular}, fotografie {n} z {total}` (for example `Adam & Eliška – svatba, fotografie 12 z 44`). Fine for accessibility fallbacks, but the admin shows a "doplňte popis" hint for empty alts, and the cover photo of every album should have a real alt (**Q-15**: will she write alt text for at least covers? Offer a 1-line helper text in Czech in the admin; the spec for the screen is in T-4).
4. Decorative images (dividers, repeated backgrounds, the logo next to its own text link) get `alt=""`. The header logo is a link: its alt is `Mullny Photos – úvodní stránka`.
5. Hero and category card images: describe the image, not the link target; the link text carries the destination.
6. Do not repeat the same alt for several photos in one album (the default in rule 3 numbers them; the admin warns on duplicates).
7. Captions (optional, shown under a photo) are separate from alt; when a caption exists, keep the alt short and let the caption add detail; do not set `alt=""` on a content photo just because it has a caption.
8. Names of private people (clients, children): only if the client agreed. **Q-16**: does she have client consent to publish names in album titles and alt text? Album titles like `Adam & Eliška` already exist on the live site; keep them only if she confirms.
9. File names served to the web are the generated storage keys; for image search the descriptive text is in alt, caption and the surrounding heading, not the file name (an optional slug-based file name can be added later, not required).
10. No text baked into images that is not repeated as real text nearby.

Tests: a build check lists photos with empty alt (warning, not a failure, thanks to the default), and fails if any rendered `<img>` lacks an `alt` attribute or has an alt matching `/\.(jpe?g|png|webp|avif)$/i`, `/^(image|photo|foto|obrázek)\b/i` or a path.

## 9. Core Web Vitals and performance budget

Targets are the "good" thresholds at the 75th percentile, measured on mobile throttled (Lighthouse mobile preset, Slow 4G profile, mid-range phone) as the gate, and with Cloudflare/Chrome field data after launch:

| Metric | Budget |
|---|---|
| LCP | at most 2.5 s (aim 1.8 s) |
| INP | at most 200 ms |
| CLS | at most 0.1 (aim 0) |
| TTFB | at most 0.8 s (static HTML on the CDN) |
| Lighthouse (mobile): Performance, Accessibility, Best Practices, SEO | 95 or more / 100 / 100 / 100 on home, portfolio, category, album |

Per page weight budget (transferred, first load, before scrolling; excludes lazy images below the fold):
- HTML: at most 40 KB compressed (JSON-LD for 20 images stays inside this).
- CSS: at most 30 KB compressed, inlined critical or a single file.
- JavaScript: at most 60 KB compressed on public pages, no framework runtime unless the architect shows a need (static pages ship near zero JS; small islands for the menu and lightbox). The old CRA bundle is 64.78 KB gzip for the same content, so this is the ceiling, not the target.
- Fonts: at most 4 files (Cormorant Garamond 400 and Lora 400, each latin and latin-ext), WOFF2, self-hosted, 84 KB total (measured 75,928 B plus about 10%; hard cap 120 KB, WP-12 / T-274).
- Images above the fold: at most 250 KB total on mobile; one LCP image at most 150 KB on mobile.
- Total first-load transfer: at most 500 KB on mobile (home).
- Third-party requests before consent: none (no analytics, no fonts CDN, no embeds); this also keeps LCP clean.

Image rules (supports VISION constraint "never load a full-size file in grids"):
- Variants generated at upload: WebP 480, 720, 960, 1600, 2400 px wide, a 1600 px JPEG fallback, an OG JPEG and the 3000 px master (used only by the lightbox zoom), per T-2 storage keys. The audit shows the current photos are 964 to 3162 px and about 1 MB each; the migration generates the variants from them (no upscaling: skip variants larger than the source). Photos stored before the 720 tier existed have a srcset without it (falls back to 960). AVIF is not generated (decision D-9, later).
- `<picture>` with a WebP `<source>` and a JPEG fallback, and `srcset` / `sizes` matching the real layout widths. Policy: cards and the album grid draw from 480, 720 and 960 (a phone at 412 px and DPR 1.75 needs about 665 px, which 720 covers; larger or denser screens pick 960, 1600 or 2400); the lightbox/full view uses 1600 and 2400; the master only on zoom.
- Every `<img>` has explicit `width` and `height` (or CSS `aspect-ratio`) from the stored dimensions, so no layout shift. A dominant colour or blurhash placeholder fills the box.
- The LCP image (hero on home, first photo on album and category) is not lazy, has `fetchpriority="high"` and is preloaded via the markup (`<link rel="preload" as="image" imagesrcset=... imagesizes=...>` only when the `<img>` cannot be found early). Everything else below the fold uses `loading="lazy"` and `decoding="async"`.
- Category and Home cards pick a tier through `sizes` (480 on desktop, 720 on phones; never the 2400 tier or the master in the initial markup) instead of one fixed tier (the old site loads a 1 MB file at 240 x 320 px displayed).
- Images are served from the object-storage public host with `Cache-Control: public, max-age=31536000, immutable` and content-hashed or versioned keys; HTML is cached short and revalidated, assets with hashed names long.
- A category page never loads more than the visible set at once: the page paints its first row of covers eagerly and the rest lazily (old `/portraits` pulled 56 MB; the target first load is under 500 KB).
- No layout shift from fonts: `size-adjust`/fallback metrics set, or `font-display: optional` for body text.
- The nav is `position: sticky/fixed` without shifting content; the mobile menu opens without reflow of the page.
- INP: no long tasks over 50 ms on interaction; lightbox and menu use native elements (`<dialog>`, `<details>`/popover) where possible.

Gate: `npm run design-check` (Lighthouse and axe per the visual-check skill) runs on the five page types and fails on a metric above budget; the weight budget is checked by a small script over the built output (HTML, CSS, JS sizes, count of `<img>` without width/height, count of third-party hosts before consent). Field data: Cloudflare Web Analytics, from launch.

## 10. Technical SEO checklist for the build (acceptance for later tasks)

- Each page: one title, one description, one canonical, one H1, OG and Twitter tags, JSON-LD per section 5, `lang="cs"`.
- Internal links are real `<a href>` (the audit found buttons and `div onClick` navigation).
- Navigation and footer link to home, the three categories, the O mně page and the Home section Kontakt (anchor); album pages link back to their category and to the previous/next album in the category (crawl paths without JS).
- Custom 404 page in Czech with links to home and categories (the old one was an English placeholder) and a real HTTP 404 status.
- Redirects (T-2): 301 from old paths and from the apex to `www`; HTTP to HTTPS; one hop only.
- HTTPS everywhere, HSTS via Cloudflare, no mixed content.
- Footer text: "Fotím v Jihomoravském kraji" (fix of the Slovak "Jihomoravskom" in the old footer).
- A consistent NAP (name, address or locality, contact) in footer, the Kontakt section and JSON-LD.
- Google Business Profile and MyWed are off-site tasks for the human, see questions. **Q-17**: does she have (or want) a Google Business Profile for Brno? It is the single biggest local-search lever for a photographer and costs nothing; the site should link to it in `sameAs` once it exists.

## 11. Open questions for the photographer (collected)

Answers are needed before the SEO text is final; none blocks the build, which uses the placeholders above.

| # | Question |
|---|---|
| Q-1 | Product photography still offered, and should it be a keyword? |
| Q-2 | Phone number to publish, or none? |
| Q-3 | Brand spelling: `Mullny Photos`, `MullnyPhotos`, `Mullny photos`? |
| Q-4 | "Fotograf" or "fotografka"; which search phrases matter most (svatební fotograf, rodinné, těhotenské, ateliér/doma)? |
| Q-5 | Service area: only Brno and Jihomoravský kraj, or all of Czechia and abroad? |
| Q-6 | Her own words for her style and the home tagline (replaces our placeholders). |
| Q-7 | Opening hours listed or not (default not). |
| Q-8 | Which photo as the Home OG image (must crop well to 1.91:1)? |
| Q-9 | OK to use her portrait as the About OG image and in `Person` markup? |
| Q-10 | Publish a street address and postal code (studio), or only the city? |
| Q-11 | Facebook page or other profiles for `sameAs`? |
| Q-12 | Publish a price range (`priceRange`) or not (default not)? |
| Q-13 | Public full name Terezie Müllnerová in markup and About (already on the live site). |
| Q-14 | Copyright statement wording and licence/inquiry page for image reuse. |
| Q-15 | Will she write alt text, at least for album covers? |
| Q-16 | Client consent to publish client names in album titles and alt text? |
| Q-17 | Does she have or want a Google Business Profile for Brno? |

## 12. Acceptance mapping

- Home, portfolio, category and album each have a title pattern, description pattern, OG image choice and canonical rule (sections 2 to 4).
- Structured data per page type with required properties: Photographer, Person, ImageGallery, BreadcrumbList, WebSite (section 5; the matrix in 5.6 and the tests listed there).
- Sitemap and robots: section 6. Alt rules: section 8. Core Web Vitals and weight budget: section 9.
- Anything that needs the photographer's wording is marked Q-n and collected in section 11.
