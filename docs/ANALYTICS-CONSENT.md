# Analytics and cookie consent spec (T-5)

Status: D-3: option C chosen; option A material is the upgrade path, not built. See [WEB.md](WEB.md#analytics).

Date: 2026-10-19. Input for the MASTERPLAN and decision D-3. Legal statements are my reading of public rules and are marked **(to verify)** where I could not confirm them against a current source (no web access in this task); this is not legal advice.

## Part 1. Audit of today's setup

Sources: `public/index.html`, `src/index.tsx`, `src/data/AnalyticsHandler.ts`, `docs/AUDIT.md` section 7.

### 1.1 Triple loading of one GA4 property

| # | Where | What it does | Fires on load |
|---|---|---|---|
| 1 | `public/index.html`: `<script async src=".../gtag/js?id=G-7QEZCZ09WY">` plus inline `gtag('config','G-7QEZCZ09WY')` | Loads gtag.js, sends a `page_view` | Yes |
| 2 | `src/index.tsx`: `ReactGA.initialize("G-7QEZCZ09WY")` (react-ga4) | Loads gtag.js a second time (same id), configures the same property again | Yes |
| 3 | `public/index.html`: GTM snippet for `GTM-5XB7XDT`, plus `<noscript><iframe>` in `<head>` (invalid there, belongs in `<body>`) | Loads gtm.js. Contents of the container unknown (H-4); it may itself contain a GA4 tag for the same id | Yes |

All three share one `dataLayer`.

### 1.2 What fires before consent

Everything. There is no banner, no consent mode, no privacy or cookie page. On the first byte of the first visit the browser requests `googletagmanager.com` (gtag.js and gtm.js), then `google-analytics.com` collect hits, and GA4 sets the `_ga` and `_ga_<id>` cookies. Google Fonts (`fonts.googleapis.com`) is also loaded without consent, which is a separate GDPR point for the rebuild (self-host the font; see T-3). Under the Czech opt-in rule for non-essential cookies and similar storage (Act No. 127/2005 Coll. on electronic communications, section 89(3), amended 2022; **to verify** the exact wording) this setup is not compliant.

### 1.3 Double-counting risk

- Sources 1 and 2 both configure the same id, so one visit can send two `page_view` hits (two `config` calls for one id, each sending a page view by default).
- If the GTM container contains a GA4 configuration tag for the same id (likely, unknown until H-4), that is a third page view.
- Enhanced measurement "page changes based on browser history events" is on by default in GA4 and reacts to `pushState`; the site uses a `HashRouter`, so hash changes may also be counted as page views (GA4 treats history changes, which includes hash changes, as virtual page views **to verify**). Result: inflated and unreliable page view numbers; all current figures should be treated as not comparable to the new setup.
- `pushAnalysisEvent("page", "PageLoad")` is called in every page's `useEffect`, so a custom event `PageLoad` is sent on top of the automatic page view. Its `category`/`action` are Universal Analytics concepts and have no meaning in GA4 reports.

### 1.4 Dead code

`pushAnalysisPageChange` in `src/data/AnalyticsHandler.ts` begins with `return;` (turned off in commit 1a92120), so the `console.log` and the `ReactGA.send` pageview after it never run. The `AnalyticAction.COMPONENT` and `LINK` values are never used. `reportWebVitals()` has no handler. None of this carries over to the rebuild; the rebuild drops react-ga4 entirely.

## Part 2. Target options

The new public site is Astro static output on Cloudflare (VISION.md proposal): real pages per URL, so page views need no SPA route tracking, and the banner is a small vanilla JS component (no framework dependency).

### 2.1 The options

**A) GA4 via plain gtag.js, Google Consent Mode v2, built-in Czech banner. GTM dropped.**
- Default consent state is set by an inline `gtag('consent','default', {ad_storage, ad_user_data, ad_personalization, analytics_storage: 'denied'})` which only writes to `dataLayer` (no network request).
- The gtag.js `<script>` is **not in the HTML**. The banner script injects it only after "Přijmout vše" (or an enabled analytics toggle in settings), then calls `gtag('consent','update', {analytics_storage:'granted'})` and `gtag('config','G-7QEZCZ09WY')`. This is the "basic" consent mode: zero requests to Google before consent. (The "advanced" mode loads gtag.js before consent and sends cookieless pings; that violates the rule "no GA/GTM request before consent", so it is excluded.)
- Reject or no choice: nothing loads, no cookies. Withdrawal: set choice to denied, run `gtag('consent','update', denied)`, delete `_ga*` cookies, and the next page load does not inject gtag.js.

**B) Same through GTM (`GTM-5XB7XDT` as the single loader), same banner.**
- Same banner and consent default, but the banner injects gtm.js after consent and the GA4 tag lives inside the GTM container (consent-gated by Consent Mode in GTM).
- Events (contact click, Instagram click, album view) can be configured in the GTM UI instead of in code.

**C) Cloudflare Web Analytics only (cookieless, no banner).**
- One small beacon script (`static.cloudflareinsights.com/beacon.min.js`) or automatic injection by Cloudflare. No cookies, no localStorage, no fingerprinting, no personal data stored, per Cloudflare's documentation **(to verify at decision time)**. Gives visits, page views, top pages, referrers, countries, devices, Core Web Vitals (real user data).
- No custom events, no conversion tracking, no audiences, no user-level data, short history in the free dashboard. Contact and Instagram clicks cannot be measured as events (could be approximated by counting visits to the contact page).
- Because it is cookieless it should not need prior consent in the EU, but the Czech authority's stance on cookieless analytics is **to verify**; many sites run it without a banner, a conservative reading would still list it on the privacy page (we do so in any case).

### 2.2 Comparison

| | A) gtag + Consent Mode | B) GTM + Consent Mode | C) Cloudflare Web Analytics |
|---|---|---|---|
| Banner needed | Yes (built in) | Yes (built in) | No (privacy page text still needed) |
| Cookies | `_ga`, `_ga_*` only after consent | Same, plus whatever the container adds | None |
| Data richness | Full GA4 (events, funnels, audiences, retention up to 14 months) | Full GA4 | Basic traffic and web vitals, no events |
| Requests before consent | None (script not loaded) | None (script not loaded) | Beacon loads for everyone (no personal data) |
| Needs from the human | Log in to GA4 once: confirm property `G-7QEZCZ09WY`, set data retention to 14 months, turn off Google signals and ad personalisation, mark key events (contact click) as key events, remove the old data stream settings if any, give Adam access | All of A, plus H-4: review the container, remove everything but one GA4 tag, restrict users | Enable Web Analytics for the site in the Cloudflare dashboard (free); if the site is on Cloudflare Pages it is one click. No account in Google. |
| Maintenance burden | Low. One snippet in code, banner code and tests. Google can change Consent Mode requirements (watch the GA4 admin messages). | Higher. Two places to keep consistent (code and GTM UI); container can be edited by anyone with access, and a stray tag could start firing before consent. Violates the guiding principle of nothing to look after | Lowest. No code except one script tag, no banner, no consent tests beyond "no cookies are set" |
| Legal basis | Consent (GDPR art. 6(1)(a) and the Czech section 89(3) opt-in), freely given, specific, withdrawable, stored at most 12 months. Google Analytics involves a US transfer (Google is on the EU-US Data Privacy Framework, **to verify**); the privacy page must name Google as processor | Same as A | Cloudflare processes only aggregate, non-identifying data; if no personal data and no storage on the device, no consent is required; legitimate interest (art. 6(1)(f)) for the minimal processing. Privacy page still states it |
| Meets VISION goal 4 literally (events, banner, Consent Mode v2) | Yes | Yes | No (no events, no Consent Mode; the vision lists it as an allowed alternative that the human decides) |
| Failure mode | If gtag.js is blocked by an ad blocker or fails, the site works; only the numbers drop (many visitors reject or block, so GA numbers will be undercounted anyway) | Same | Same |

### 2.3 Recommendation

**Recommend A**: GA4 through plain gtag.js with Consent Mode v2 (basic mode, script injected only after consent) and the built-in Czech banner; drop GTM and react-ga4.

Reasons: it is the only option that delivers what goal 4 lists (one tag, page views counted once, contact/Instagram/album events, banner with Consent Mode v2) without a second system to keep in sync; B adds a UI that can silently start unconsented tags and has to be audited by hand (H-4), which is the opposite of "nothing to look after". The banner is about 150 lines of vanilla JS plus one test file, built once.

**Fallback C** if the photographer only cares about visit counts and top pages: no banner, no Google, no legal exposure, near zero care. It is a legitimate answer to the guiding principle; the cost is no event data. Realistic note: with about 9 shoots a year the traffic is small, and many Czech visitors will reject the banner, so GA4 will show only a fraction of visits; C counts everyone. A hybrid (A for events plus C for real traffic totals) is possible at the price of one more script; not recommended in v1 to avoid two tools.

Whichever is picked, the rebuild has exactly one analytics loading path.

## 3. Consent banner (applies to A; B identical)

### 3.1 Behaviour rules

- First visit: banner at the bottom, a non-blocking region (`role="dialog"`, `aria-labelledby`, `aria-modal="false"`, focus moved to it, not a full-page wall). The site is usable without choosing; no choice means denied.
- Buttons "Přijmout vše" and "Odmítnout vše" are the same size, same style weight, same visual prominence (both filled or both outlined, no colour that nudges). "Nastavení" is a third button of the same size.
- Settings panel: toggle for "Analytická měření" (off by default), "Nezbytné" shown as always on (stores only the consent choice, see below), buttons "Uložit výběr", "Přijmout vše", "Odmítnout vše".
- Choice stored in `localStorage` key `mp_consent` as `{v:1, analytics:true|false, ts:<ms>}`. Expires 12 months after `ts` (checked on load; on expiry ask again). Stored for "no" as well as "yes" so rejecting is respected.
- Withdraw: footer link "Nastavení cookies" reopens the banner with the current choice; changing to "no" deletes `_ga` and `_ga_G-7QEZCZ09WY` cookies on the domain and ends measurement for the session.
- Banner script is inline-free, no dependencies, respects `prefers-reduced-motion`, keyboard operable, focus visible, text readable at 400% zoom (see a11y gate).

### 3.2 Czech texts (drafts for the photographer to approve)

Banner:
- Title: "Cookies a soukromí"
- Body: "Web používá analytické cookies Google Analytics, aby bylo vidět, které stránky návštěvníky zajímají. Spustí se jen s vaším souhlasem. Bez souhlasu se nic neukládá a žádná data se neodesílají."
- Link: "Zásady cookies a ochrany soukromí" (to `/cookies/`)
- Buttons: "Přijmout vše" | "Odmítnout vše" | "Nastavení"

Settings panel:
- Heading: "Nastavení cookies"
- Row 1: "Nezbytné" with the note "Uloží pouze vaši volbu ohledně cookies. Nelze vypnout." (always on)
- Row 2: "Analytická měření" with the note "Google Analytics: anonymní statistiky návštěvnosti (které stránky se čtou, odkud návštěvníci přicházejí). Můžete kdykoli změnit." (toggle, off by default)
- Buttons: "Uložit výběr" | "Přijmout vše" | "Odmítnout vše"

Footer link: "Nastavení cookies". Confirmation (live region, `role="status"`): "Vaše volba byla uložena."

If C is picked: no banner, footer link and settings are removed; the privacy page keeps the short analytics paragraph.

## 4. Cookie and privacy page contents (`/cookies/`, Czech; page text lives in code)

1. Who we are (the controller): Terezie Müllnerová, Mullny Photos, Brno; address/IČO as the photographer provides (question for her; **the controller details must be real and complete**); contact e-mail `mullnyphotos@gmail.com`.
2. What the site stores, as a table: name, provider, purpose, duration.
   - `mp_consent` (localStorage), this site, remembers your choice, 12 months, necessary.
   - `_ga` (cookie), Google, distinguishes visitors, 2 years by default (A/B only; shorter if configured, **to verify**), analytics, only with consent.
   - `_ga_G-7QEZCZ09WY` (cookie), Google, keeps session state, 2 years by default, analytics, only with consent.
   - Under C: no cookies and no local storage; Cloudflare Web Analytics measures without them.
3. Purpose and legal basis: consent (GDPR art. 6(1)(a)) for analytics; legitimate interest for security and delivery of the site (hosting on Cloudflare).
4. Recipients and transfers: Google (analytics, A/B) and Cloudflare (hosting/CDN, images), data may leave the EU; safeguards (EU-US Data Privacy Framework / standard contractual clauses, **to verify** current status). Supabase is not contacted by visitors on the public site, mention only if that changes.
5. How to change or withdraw consent: the footer link "Nastavení cookies", effect immediate; how to delete cookies in the browser.
6. Your rights: access, rectification, erasure, restriction, objection, portability, complaint to the Úřad pro ochranu osobních údajů (uoou.gov.cz).
7. Other processing: e-mail enquiries (mailto only today, a contact form would add its own paragraph), external links (Instagram, MyWed) have their own policies; fonts self-hosted (no Google Fonts request, per T-3).
8. Date of last update.

## 5. Events (A and B)

Sent only after consent, via `gtag('event', name, params)` in one small module `analytics.ts` (no react-ga4). Names are GA4 snake_case.

| Goal | Event | Trigger | Parameters |
|---|---|---|---|
| Page view | `page_view` | Sent once by `gtag('config', id)` after consent on each full page load (the site is multi-page, so no history events). Set `send_page_view` default, and turn off enhanced-measurement history changes in the GA4 stream so a hash or `pushState` cannot double count. | automatic |
| Contact click | `contact_click` | Click on a `mailto:` link or the contact button | `method: "email"`, `location: "header" | "footer" | "contact_page"` |
| Instagram click | `instagram_click` | Click on any link to instagram.com | `location` as above |
| Album view | `view_album` | Album page loaded (one event on page load, `data-album-slug` attribute on the page) | `album_slug`, `category_slug` |

Delegated click listeners (`a[href^="mailto:"]`, `a[href*="instagram.com"]`) in the analytics module; they run only if analytics consent is granted at the moment of the click. Mark `contact_click` as a key event in GA4 (human step). The audit's `PageLoad` event is dropped. If the consent is given on a page, send the `page_view` for that page at that moment (the first page of a visit is not lost). Events fired before consent are not queued and not replayed (no storage of unconsented behaviour).

## 6. How a test proves nothing fires before consent

Three layers, all runnable offline.

1. **Unit (Vitest, jsdom)** for the consent module and `analytics.ts`:
   - Without a stored choice: `loadAnalytics()` is a no-op, `document.querySelector('script[src*="googletagmanager"]')` is null, `window.dataLayer` contains only the consent `default` command (all denied), `document.cookie` has no `_ga*`.
   - With `analytics:false` stored: the same. With an expired choice (`ts` older than 12 months): treated as no choice, banner shown.
   - After `acceptAll()`: the gtag script element is added once (never twice), `consent update` granted is pushed, `mp_consent` is written. After `rejectAll()` following accept: `_ga*` cookies deleted and no new script added on the next load.
   - A spy on `window.fetch`, `navigator.sendBeacon` and `XMLHttpRequest.prototype.open` asserts zero calls before accept.
2. **Static (Vitest, reads the built HTML)**: every built page in `dist/` is scanned; the test fails if the HTML contains `googletagmanager.com`, `google-analytics.com`, `gtag/js` or `gtm.js` as a script `src`, `<iframe src>` or link, or the id `GTM-5XB7XDT`. (The id `G-7QEZCZ09WY` may appear only in the lazy-loading module, not in HTML.) This catches a regression where someone pastes the old snippet back.
3. **Browser (Playwright against the built site, a `test:e2e` script that does not exist in this repo)**: open the page with a clean context, register `page.on('request')` and record every URL; wait for network idle; assert no request to `googletagmanager.com`, `google-analytics.com`, `analytics.google.com`, `doubleclick.net`, and `context.cookies()` has no `_ga*`. Then click "Odmítnout vše" and repeat (still none). Then in a new context click "Přijmout vše" and assert the gtag request appears (proves the test can see requests) and `contact_click` fires once on a mailto click. Playwright is a devDependency only; if it cannot run in the autopilot environment, layers 1 and 2 are the gate and layer 3 is a documented manual check in the README. A visual check of the banner is part of the design-check (banner on mobile and desktop, light and dark).

For option C, layers 2 and 3 change to "no Google domains at all, no cookies, no storage keys set".

## 7. Open points

- H-4 (human): what the GTM container fires and who has access (needed only for B, or to confirm the old container can be deleted under A).
- The photographer's real address/IČO and wording approval for section 4 and the banner texts.
- To verify: Czech section 89(3) wording and the ÚOOÚ view on cookieless analytics; Google cookie lifetimes; EU-US Data Privacy Framework status; Cloudflare Web Analytics cookieless claim and retention; GA4 handling of hash changes.
- GA4 admin steps (human, A only): data retention 14 months, Google signals off, disable enhanced-measurement history-change page views, mark `contact_click` as key event, delete the unused data stream if any.
