# Texts review for the photographer

All page text lives in `apps/web/src/content/texts.ts` and `reviews.ts`. It was copied word for word from the old site (branch `legacy-cra`), then only the changes below were made. Please approve or correct each one.

## Changes (before and after)

| # | Where | Before | After |
|---|---|---|---|
| 1 | Footer | Fotím v Jihomoravskom kraji | Fotím v Jihomoravském kraji |
| 2 | Contact, Instagram block | Pavidelne na něj přidávám | Pravidelně na něj přidávám |
| 3 | Site description, meta, manifest | Focení svateb, portrétu a párových fotek | Focení svateb, portrétů a párových fotek |
| 4 | Mail link | `mailto: mullnyphotos@gmail.com` (space) | `mailto:mullnyphotos@gmail.com` |
| 5 | About, "Můj příběh" | ...co jsem zažila. nebo skrz fotografie... | ...co jsem zažila. Nebo skrz fotografie... |
| 6 | About, "Můj příběh" | ...utekly. proto jsem se rozhodla... | ...utekly. Proto jsem se rozhodla... |
| 7 | About, "Můj příběh" | ...dívat se kolem sebe. a čerpat tu jednoduchost... | ...dívat se kolem sebe a čerpat tu jednoduchost... (the stray full stop removed) |
| 8 | About, all three blocks, both reviews, Contact | Runs of 4 or more spaces from the old line breaks in the code, and in a few places no space at all (for example "fotografií.Můžu", "zážitek...", "Lidské příběhy... v něm.Věřím") | A single space everywhere |
| 9 | Home intro, reviews | Trailing space at the end of the text | Removed |
| 10 | Navigation | "- Svatby", "- Portréty", "- Párové focení" (dash was a visual marker) | "Svatby", "Portréty", "Párové focení" |
| 11 | 404 page (was never reachable) | This is non found | Stránka nenalezena (title as in SEO.md) and a short Czech sentence with links back |
| 12 | Page for visitors without JavaScript | You need to enable JavaScript to run this app. | Dropped: the new site is plain HTML and needs no JavaScript to read |
| 13 | Image descriptions | alt "Image", "Photo 1..3", file path | Dropped: proper alt texts come from the SEO rules |

## Not changed, but you may want to

These were left exactly as on the old site because they are not clear typos. Tell us if you want any of them fixed.

- Reviews are written in the voice of the clients; "byli velmi profesionální ... a velmi rychlá" (Anež) mixes plural and singular, and "pro vaši další focení" should probably be "pro vaše další focení". "jedna z nejlepších fotografů" (Pati) should be "jedna z nejlepších fotografek".
- About: "Věřím že naše spolupráce" lacks a comma before "že"; "a nebo" is colloquial; "několika měsíční" should be "několikaměsíční"; "Díky ... několikaletými zkušenostmi" should be "několikaletým zkušenostem"; "Fotografování byl pro mě" should be "Fotografování bylo pro mě"; "dosáhnout skvělé výsledky" should be "skvělých výsledků".
- Home: "portrétní párové a svatební" lacks a comma after "portrétní".
- Capitalised "Vás"/"Vaše" and lowercase "vám"/"váš" are mixed on the old site.

## Placeholders to check (About and Contact)

These are our wording, not yours. Please check that they describe the photos correctly.

- About photo alt texts: main photo "Nevěsta v bílých šatech zvednutá ženichem v pšeničném poli v zlatém světle"; "Ženich líbá nevěstu na čelo, nevěsta drží kytici z kapradí a trav"; "Svatební dort s lesním ovocem a dřevěným zápichem Pan & Paní na plátku kmene"; "Muž sedí na houpačce pod starou vrbou a dívá se na malou holčičku".
- Contact photo alt texts: main photo "Nevěsta opřená hlavou o rameno ženicha se dívá do objektivu"; "Usměvavý pár sedí v lese opřený o kmen stromu".
- Heading "Napište mi" above the contact text (the old site had no heading there) and the hidden note "(Instagram, otevře se v novém okně)" on the Instagram button.
- The About page opens with the "O MNĚ" text as the first block under the page title (the title is not repeated).

## Cookies page (open `[doplnit]` items)

The text on `/cookies/` is our wording, reduced to what is true today (no cookies, Cloudflare hosting, self-hosted fonts, e-mail only). Please check it and fill in:

- **[doplnit] Controller name** (your name or trading name) and **address**. The page shows `[doplnit]` until these are entered in `apps/web/src/content/texts.ts` (`COOKIES.controller`). The page must not go live with the markers.
- **IČO is optional (T-220, please review).** If you work as a private person without IČO, leave `COOKIES.controller.companyId` empty: the "IČO" line is then not shown at all, and name, address and e-mail are enough. If you have an IČO, enter it and the line appears. Copy change for your approval: the page no longer shows an "IČO" row by default.
- **To approve: analytics paragraph** (`COOKIES.ANALYTICS_PARAGRAPH`, heading "Měření návštěvnosti"). It appears on `/cookies/` only in a build that has the Cloudflare Web Analytics token; without the token the page has no such section. Wording: "Web měří návštěvnost službou Cloudflare Web Analytics. Měření nepoužívá cookies ani místní úložiště prohlížeče a neukládá do vašeho zařízení nic. Zpracovávají se jen souhrnné technické údaje o návštěvě, například zobrazená stránka, odkazující web, země, typ zařízení a prohlížeče a rychlost načtení stránky. Službu poskytuje společnost Cloudflare, která provozuje servery po celém světě. Údaje používám k tomu, abych poznala, které stránky návštěvníky zajímají a zda se web rychle načítá; právním základem je můj oprávněný zájem. Měření můžete zablokovat v prohlížeči nebo blokátorem obsahu, web funguje stejně i bez něj." Please approve or correct it before the first production deploy with analytics.
- **[doplnit] Date of last update**, to be added when the text is approved.
- Please confirm the 404 wording "Tuto stránku se nepodařilo najít. Vraťte se na úvod nebo si prohlédněte portfolio." and the link list under it.

## Questions

- **Q-1 (product photography).** "Mé zkušenosti" says: "přes 46 000 fotek portrétů, 12 000 fotek svateb a 4 000 fotek produktů", and Contact mentions "produktů". Copied unchanged. Do you still offer product photography, and are these numbers still true? We will not use "produktové focení" as a keyword until you confirm.
- **Q-6 (home tagline and style).** The first line under the logo on the home page and the descriptions in SEO.md are our placeholder wording, not yours. In what words do you describe your style (for example "přirozené", "reportážní") and what should the home tagline say? Until you answer, the old intro "Vítejte na mé stránce" and the placeholder text stay.
- **Q-16 (client names).** Album titles and the review headings contain first names of clients (Adam & Eliška, Pati, Anež, ...). Do you have their consent to publish the names in titles and in image descriptions? If not, we shorten them to initials or neutral names.
