# Findability in search and by AI assistants (T-217)

Date: 2026-10-21. Goal: be found for "fotograf Brno" (and "svatební fotograf Brno", "portrétní focení Brno") in Google and other search engines, and be readable by AI assistants and their crawlers. Builds on `docs/SEO.md` (titles, canonical, JSON-LD, sitemap, alt rules), which stays the spec.

## Honest note

Nobody can guarantee that ChatGPT, Claude, Perplexity, Gemini or any other assistant will mention Mullny Photos. These systems pick sources by their own, changing rules, often from the same signals as search engines (a clear site, mentions on other sites, a Google Business Profile, directory listings). What we can do is make the site easy to read, correct and consistent, and not block the crawlers. The rest depends on the human steps below and on time.

## Audit result (what was already in place)

- Real prerendered HTML on every page: title, description, canonical, Open Graph, JSON-LD. No JavaScript needed to read it.
- JSON-LD `Photographer` on Home and Contact with `address` (Brno, Jihomoravský kraj, CZ), `areaServed` (City Brno, AdministrativeArea Jihomoravský kraj), `email`, `sameAs` (Instagram, MyWed). `WebSite`, `Person`, `ImageGallery`, `BreadcrumbList` on the other pages. Never `Review`, `AggregateRating`, `telephone`, `priceRange` or a street address (see SEO.md 5.1).
- Titles and descriptions already name Brno on Home, categories, About, Contact and Portfolio (`apps/web/src/lib/seo.ts`).
- Sitemap `/sitemap.xml` (home, portfolio, categories, albums with images, About, Contact, cookies), checked against the canonicals by `page-checks` (`checkSitemapCanonical`).
- Internal links are real `<a href>`; the `links` page-check fails on any internal link that resolves to nothing. Navigation and footer link to all main pages; albums link to their category and neighbours.
- Image alt text: SEO.md section 8; `page-checks` fails on a missing or filename-like alt.

## What was changed

1. `robots.txt` (production only): `User-agent: *` stays, and the crawlers `GPTBot`, `OAI-SearchBot`, `ChatGPT-User` (OpenAI), `ClaudeBot`, `Claude-SearchBot` (Anthropic), `PerplexityBot`, `Google-Extended` (the token that governs use of the site for Google's Gemini training and grounding) are each named with `Allow: /`. List: `AI_CRAWLERS` in `apps/web/src/lib/sitemap.ts`. To stop one, delete its name there. Non-production still serves `Disallow: /`.
2. `/llms.txt`, generated at build from the catalog (`apps/web/src/lib/llms.ts`, endpoint `apps/web/src/pages/llms.txt.ts`): a short Markdown summary (who, where, services, page list with album counts, contact). Only facts already on the site; no prices, no phone. `llms.txt` is a convention, not a standard, and no major assistant has promised to read it; it costs nothing.
3. JSON-LD `Photographer` gained a factual `description` ("Fotografka Terezie Müllnerová z Brna: svatební, portrétní a párové focení v Brně a Jihomoravském kraji."), shared with `llms.txt` (`BUSINESS_DESCRIPTION` in `apps/web/src/lib/jsonld.ts`). `areaServed` Brno and `sameAs` Instagram were already present. No `priceRange`.
4. Tests: `sitemap.test.ts` (AI crawlers in robots), `jsonld.test.ts` (description, areaServed Brno), `llms.test.ts`.

`sameAs` currently lists Instagram and the MyWed profile, which is already linked in the site footer and known from the live site. The profile URL of any other wedding directory is not known; it is intentionally left out (see human inputs).

## Proposed wording for Brno in the visible text (needs her approval, Q-6)

Not applied. The home hero shows the H1 "Mullny Photos" and the tagline `SITE.description` = "Focení svateb, portrétů a párových fotek". That string is also the manifest description and is pinned by `apps/web/src/content/texts.test.ts` and `apps/web/public/manifest.webmanifest`, and the tagline is the photographer's own copy, so it was not changed. The `<title>` and meta description of Home already say "Fotograf Brno", and the "hello" text already says "fotografka z Brna", so the visible page does name Brno.

Proposal, to apply only after she agrees (each is a one-line change and easy to revert):

- Tagline (`SITE.description` in `apps/web/src/content/texts.ts`, plus the same text in `public/manifest.webmanifest` and the pinned test): "Focení svateb, portrétů a párových fotek v Brně". Keep the H1 "Mullny Photos".
- About text (`ABOUT.me.body`): add one sentence at the start or end, for example "Fotím v Brně a okolí: svatby, portréty a páry." Only if it is true to her (Q-5: service area; Q-1: products).
- Do not add price, phone or claims she has not confirmed.

## What only the human can do

1. Google Business Profile for Brno (service-area business, no street address needed if she works from home): the strongest local lever; then add its URL to `sameAs` (Q-17).
2. Google Search Console: verify `www.mullnyphotos.cz` (DNS TXT record), submit `https://www.mullnyphotos.cz/sitemap.xml`, check Pages/coverage after a few days. Optionally Bing Webmaster Tools (feeds several AI products).
3. Directory backlinks: keep the MyWed profile current and linking to the site; add other Czech wedding/photographer directories she actually uses and tell us the profile URLs so they can be added to `sameAs`. The wedding-directory profile URL beyond MyWed is a human input.
4. Link the site from Instagram: put `https://www.mullnyphotos.cz` in the bio link and use the same name "Mullny Photos" and "fotografka Brno" in the bio.
5. Answers to the open questions in `docs/SEO.md` section 11 (Q-1, Q-4, Q-5, Q-6 especially) and approval of the wording above.
6. Ask happy clients to mention her name and city on their own pages or in reviews; real mentions elsewhere help more than anything on the site.

## Verification

`npm test`, `npm run typecheck`, `npm run gates -- --strict`, and `npm run check:site` (page-checks: JSON-LD parses and matches the type matrix, sitemap vs canonicals, links, alt). JSON-LD can also be pasted into the Schema.org validator before cutover.
