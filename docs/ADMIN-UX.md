# Admin: screens and flows (spec)

**As built (WP-5):** the admin is implemented in `apps/admin`. Where the build differs from this spec on purpose, the
list is in [ADMIN.md](ADMIN.md) "Deviations" (inline buttons, two album badges, no "use the real value" step, and so on);
deploy steps and the photographer's guide are there too. The text below is the original spec.

Task T-4. Source: VISION.md goal 3, T-6 (storage quota guard). This is a spec for the admin SPA (`apps/admin`, planned at admin.mullnyphotos.cz). Nothing here is built yet; the MASTERPLAN may change technical details, but not the goals mapped below.

## 1. Scope and principles

- One user: the photographer, on a laptop (main) and a phone (small edits). No public sign-up.
- The admin manages **categories, albums and photos only**. Page texts (Home, About, Contact, services) are NOT editable: they stay in code and change through a developer. There is no CMS, no pages screen, no blog. Nothing in the UI may suggest otherwise.
- All UI labels are Czech (section 9). The vocabulary is fixed: kategorie, album, fotka, skrýt, zveřejnit, smazat.
- Every action that changes data saves to the database at once (draft state). The public site changes only after "Zveřejnit web" (section 6). So the photographer can work freely and publish when ready.
- Destructive actions always ask for confirmation naming what will be lost. Hiding is the safe alternative and is offered first.
- Progress and errors are always visible and in plain Czech with a next step ("Zkusit znovu"). No technical codes in the UI (codes may sit behind a "Podrobnosti" disclosure).
- Accessibility (WCAG 2.2 AA): every drag and drop action has a keyboard/button alternative (move up/down, "Přesunout do pozice"), progress and errors are announced in `aria-live` regions, touch targets at least 44 px, visible focus.
- Storage limits (hard limit 9.5 GB, warning from 8 GB) are config values read from the server, never constants in components (T-6).

## 2. Information architecture

```
/prihlaseni                       Login
/                                 Categories list (home of the admin, with storage bar and publish bar)
/kategorie/:id                    Category detail (its albums)
/alba/:id                         Album detail (photo grid)
/alba/:id/foto/:photoId           Photo detail (alt, caption, move) - side panel on desktop, full screen on phone
/nahravani                        Upload queue (also a drawer reachable from every screen)
/zverejnit                        Publish (status and history)
/ulozeni                          Storage usage detail and reconcile
```

Persistent shell on every screen after login:
- Top bar: logo text "Mullny Photos – správa", storage mini-bar (click opens /ulozeni), upload queue indicator (count of running/failed files), "Zveřejnit web" button with a dot when there are unpublished changes, "Odhlásit se".
- Breadcrumb: Kategorie > Svatby > Frankovi.
- Mobile: top bar collapses to title + overflow menu; a bottom bar offers Kategorie, Nahrávání, Zveřejnit.

## 3. Screens

### 3.1 Login (`/prihlaseni`)
- Sign-in is with Google only (WP-09, D-16): no e-mail or password fields, no reset link, no "Registrovat". Card title "Přihlášení", explanation "Do správy se přihlašujete účtem Google. Přístup mají jen dva povolené účty.", button "Přihlásit se přes Google", and under it the tip "Tip: zapněte si v účtu Google dvoustupňové ověření, správa je pak lépe chráněná." (the app cannot enforce or detect 2-step verification; it is only a tip).
- States: busy (button not usable, "Přesměrovávám na Google…"); after the return from Google "Ověřuji přihlášení…"; account not allowed (not on the allow-list, unverified e-mail, sign-up refused; one text on purpose) "Tento účet Google nemá přístup do správy. Zkuste se přihlásit jiným účtem Google." and the local sign-out; cancelled at Google "Přihlášení přes Google bylo zrušeno."; other callback failure "Přihlášení přes Google se nepodařilo. Zkuste to znovu."; too many attempts "Příliš mnoho pokusů, zkuste to za chvíli."; offline "Chybí připojení k internetu.".
- Session expiry during work: a modal "Přihlášení vypršelo" with the body "Přihlaste se znovu přes Google. Po přihlášení se stránka načte znovu, neuložené změny a fotky ve frontě se ztratí." and the Google button. Signing in again is a full-page redirect, so the in-memory upload queue and unsaved form state are lost (the text says so); the stored return path brings her back to the same screen.
- Layout: one centred card, max 24rem, same on phone and desktop.

### 3.2 Categories list (`/`)
- Content: header "Kategorie" with button "Nová kategorie"; storage bar; list of categories as cards/rows: name, number of albums, number of photos, visibility badge ("Viditelná" / "Skrytá"), drag handle, overflow menu (Přejmenovat, Skrýt/Zobrazit, Smazat).
- Row click opens the category detail.
- New category: dialog with Název (required), Slug (auto from name, editable, unique, lowercase ASCII), Popis (optional), SEO titulek and SEO popis (optional, under "Pro vyhledávače"). Buttons "Vytvořit" / "Zrušit".
- Rename: inline in the dialog "Upravit kategorii" (same fields). Changing the slug shows the warning "Změna adresy rozbije stávající odkazy na tuto kategorii a její alba." (old URL redirects are a MASTERPLAN question).
- Reorder: drag handle on desktop and phone (long press), or the keyboard sensor on the handle. No move buttons (T-243). Order saves instantly, toast "Pořadí uloženo".
- Empty state: "Zatím tu nejsou žádné kategorie." + button "Nová kategorie".
- Error: failed load "Kategorie se nepodařilo načíst." + "Zkusit znovu".

### 3.3 Category detail (`/kategorie/:id`)
- Header: category name, badge, buttons "Upravit kategorii", "Nové album".
- Album list: cover thumbnail, title, place, date, photo count, status badge ("Zveřejněno", "Koncept", "Skryto"), drag handle, overflow menu (Otevřít, Skrýt/Zveřejnit, Přesunout do jiné kategorie, Smazat).
- Reorder albums as in 3.2.
- New album: dialog with Název (required), Kategorie (preselected), Místo, Datum focení; the rest is edited on the album screen. Creating the album opens album detail with the upload drop zone in front.
- Empty state: "V této kategorii zatím nejsou žádná alba." + "Nové album".
- Desktop: table-like list, two columns of detail at most. Phone: stacked cards, handle on the left, menu on the right.

### 3.4 Album detail (`/alba/:id`)
Top area:
- Title (inline editable), status badge, buttons "Zveřejnit album" / "Skrýt album", "Smazat album" (in overflow on phone).
- "Údaje o albu" panel (collapsible): Název, Místo, Datum focení, Popis, Slug, and under "Pro vyhledávače": SEO titulek, SEO popis. Autosave on blur with a small "Uloženo" status; validation message under the field (e.g. "Adresa je už použitá jiným albem.").
- Storage bar is not repeated here, only the top-bar mini-bar.

Photo area:
- Upload drop zone at the top: "Přetáhněte sem fotky nebo klikněte pro výběr" with button "Vybrat fotky" (phone: opens camera roll). Accepts JPEG, PNG, HEIC, WebP; rejects other types with a per-file message.
- Photo grid: square thumbnails (variant 480 px, never the original), cover marked with a "Titulní" badge, hidden-state not applicable to single photos (hiding exists at album level only; see 8), alt-text warning dot on photos without alt text. Drag handle on each tile. Selection mode: checkbox on each tile, a sticky action bar "Vybráno 5: Přesunout do alba, Smazat, Zrušit výběr".
- Tile menu / photo detail: "Nastavit jako titulní", "Upravit popisek", "Přesunout do jiného alba", "Smazat fotku".
- Quality verdict (WP-10): every photo carries a badge "Nízké rozlišení" (master long edge under 2000 px), "Chybí varianta" or "Dobré", also in the photo detail, the album summary ("{low} z {total} … je v nízkém rozlišení") and the filter "Jen nízké rozlišení".
- Replace with a better file (WP-10, option A): detail action "Nahradit lepší verzí" with a before/after confirmation. The new photo is added to the same album (new id, new image URLs, same album URL), takes over sort, alt, caption and cover, then the old photo is deleted. Recovery state if interrupted: "Nahrazení nedokončeno" (Dokončit / Zrušit). Atomic variant only proposed: [REPLACE-PHOTO-OPTIONS.md](REPLACE-PHOTO-OPTIONS.md).
- Photo detail (side panel on desktop, full screen on phone): large preview (1600 px variant), Alternativní text (alt, with hint "Popište, co je na fotce, pro nevidomé a vyhledávače"), Popisek (caption), buttons "Uložit", "Předchozí", "Další".
- Empty state: "V albu zatím nejsou žádné fotky." with the drop zone enlarged.
- Desktop: grid 5 to 6 columns, detail in a right panel. Phone: 2 columns, detail full screen, drag by long press, selection mode as the primary way to bulk-act.

### 3.5 Upload queue (`/nahravani` and drawer)
One queue for the whole session, visible from every screen (top-bar indicator opens the drawer).
- Per file row: thumbnail (local preview), file name, target album, step label, progress bar, size, buttons "Zrušit" (queued/running) or "Zkusit znovu" (failed), "Odebrat z fronty" (failed/done).
- Overall summary on top: "Nahráno 23 z 40 · zbývá asi 4 min" with one bar, button "Zrušit vše", "Zkusit znovu neúspěšné (3)" once something failed.
- Steps per file (label text, in order): "Ve frontě", "Zpracovávám" (resize and convert in the browser to the five WebP tiers 480/720/960/1600/2400 px, a 1600 px JPEG fallback, the OG image and the master), "Nahrávám", "Ukládám", "Hotovo".
- Processing requirements (the encoder follows `variantPlan` in `packages/shared` exactly; a missing or extra tier is refused at commit):
  - It computes the dominant colour of every photo (`#rrggbb`, for example from a canvas downscale) and sends it as `dominant_color`; it is the placeholder block shown before the image loads.
  - The one-off legacy migration does the same with sharp stats on a small downscale (`dominantColorOf` in `scripts/dev-images.ts`), so no photo keeps a null `dominant_color`.
  - The master is always re-encoded (never uploaded as the original file) so EXIF and GPS metadata are stripped; the master is publicly linked for zoom.
  - Quality (WP-10): one maximum-quality JPEG in; the overview set (WebP 480/720/960) is small and sharp, the detail set (WebP 1600/2400, JPEG 1600, master at JPEG q0.90 with a 5 MB cap) is the best quality. Per-tier qualities and caps: [ADMIN.md](ADMIN.md) "Photo quality (WP-10)", source of truth `packages/shared/src/photo-quality.ts`.
  - The step label "Zpracovávám" is shown as two phases, "Připravuji náhledy" and "Nahrávám detail". A source with a long edge under 2000 px is accepted with the warning "Původní fotka je malá, bude jen do {n} px".
- Concurrency: 3 files at once; the queue survives navigation inside the SPA; closing the tab during uploads triggers the browser "leave page?" warning while the queue is not empty.
- Failure states (each file, independent; one failure never stops the rest):
  - Unsupported file: "Nepodporovaný formát (JPEG, PNG, HEIC, WebP)."
  - Input limits (WP-10, checked from the file header before decoding; nothing is uploaded): file over 50 MiB: "Soubor je příliš velký (nad 50 MB). Zmenšete ho a zkuste to znovu."; over 64 MP (40 MP on a touch device): "Fotka má příliš mnoho pixelů (nad 64 MP; na telefonu nad 40 MP)."; unreadable header: "Tuto fotku se nepodařilo načíst." The per-part server cap (`max_upload_bytes`, 40 MiB) is a separate, later check. The old "100 MP" limit no longer exists.
  - Cannot process (corrupt): "Fotku se nepodařilo zpracovat."
  - Network lost: file pauses with "Čekám na připojení…", resumes automatically when online, up to 3 automatic retries with backoff, then "Nahrávání selhalo. Zkusit znovu".
  - Upload URL expired: silently asks for a new URL once, then as a network failure.
  - Session expired: queue pauses, sign-in modal (3.1); after the Google redirect the page reloads and the queue is gone, so the missing photos are uploaded again.
  - Storage full (T-6, refused by the server before any URL is issued): the whole batch (or the files that do not fit) gets "Úložiště je plné. Nelze nahrát další fotky, uvolněte místo smazáním fotek." and nothing partial is left behind. The browser shows the same check beforehand as a courtesy, but the server decides.
  - Storage near limit: warning banner (see 3.7) but uploads continue.
- Duplicates: a file with the same name and size already in the album gets the prompt "Tato fotka už v albu je. Přeskočit / Nahrát znovu" (default skip).
- Done: toast "Nahráno 40 fotek." with link "Zobrazit album"; the grid updates live. Partial: "Nahráno 37 z 40, 3 se nepodařilo." with the retry button.

### 3.6 Publish (`/zverejnit` and top-bar button)
- Purpose: push saved changes to the public site (triggers the Cloudflare rebuild deploy hook). Photographer's mental model: "Uložené změny se na webu objeví až po zveřejnění."
- Top-bar button "Zveřejnit web" shows a dot and the count of unpublished changes ("3 změny") when the data differs from the last published build.
- Screen content: summary of changes since last publish (new album Frankovi, 12 photos added, album Mia hidden), button "Zveřejnit web", last published time ("Naposledy zveřejněno 19. 10. 2026 14:32"), and the last 10 publishes with status.
- Confirmation: none needed for publish itself (it is reversible); button label changes to "Zveřejňuji…".
- States: building "Web se aktualizuje, trvá to asi 1 až 2 minuty." (polled status, `aria-live`); success "Web je aktualizovaný." with link "Zobrazit web" (opens the public site); failure "Zveřejnění se nepodařilo. Web zůstává ve stavu před touto změnou. Zkusit znovu." (the old public site keeps serving); repeated press while building is ignored ("Zveřejnění už probíhá.").
- Nothing to publish: button disabled with "Žádné nové změny."
- Publishing is the only way a change goes public, so a hidden or deleted album disappears from the public site only after this step. This is stated in the confirmation of hide and delete.

### 3.7 Storage usage bar (T-6) (`/ulozeni` and the shell widget)
- Mini-bar in the top bar: "Úložiště 3,2 z 9,5 GB". Same bar, larger, on the categories list and on `/ulozeni`.
- Colour states (also text, never colour alone): normal; warning from 8 GB "Úložiště se plní (8,2 z 9,5 GB). Zvažte smazání nepotřebných fotek." (amber, `role="status"`); full "Úložiště je plné. Nahrávání je zastaveno." (red, `role="alert"`) and the drop zones show disabled with the same message.
- `/ulozeni` detail: used / limit, percentage, breakdown per album (name, photos, size, link), sorted by size; button "Zkontrolovat úložiště" = reconcile (compares the database total with the real bucket size; result "Součet souhlasí." or "Opraveno: databáze ukazovala 3,4 GB, skutečně 3,2 GB." with a "Použít skutečnou hodnotu" confirmation before it writes).
- Per-photo list (WP-10): "Fotky podle velikosti", heaviest first, paged (a page of rows, not all photos in the DOM), album filter, the per-variant breakdown ("Rozpis souborů"), the share of the limit and the quality verdict badge. About 3.3 MB per photo at the new quality, so roughly 2,880 photos fit under the 9.5 GB hard limit.
- Limits (hard limit, warning threshold) come from server config; the bar renders whatever the server returns.
- Deleting photos or albums lowers the total; the bar updates right after the delete completes.

## 4. Flows end to end

### F1 Create an album and upload 40 photos
1. Categories list > open "Svatby" (or any category) > "Nové album".
2. Dialog: Název "Novákovi", Místo "Brno", Datum focení; "Vytvořit". The album opens as a Koncept (not public).
3. Drop 40 files on the drop zone (or "Vybrat fotky"). The app checks types and sizes, asks the server for upload URLs for the batch (server checks quota: current total + size of the batch against the limit; refusal shows the "Úložiště je plné" message and nothing is queued).
4. Queue drawer opens automatically. Per file: Zpracovávám > Nahrávám > Ukládám > Hotovo; 3 in parallel; summary "Nahráno 23 z 40".
5. Tiles appear in the grid as each file finishes, in the order of the selection (file name order). Failed files stay in the queue with "Zkusit znovu".
6. When done, toast "Nahráno 40 fotek". The first photo becomes the cover automatically until the photographer picks another (F3).
7. Optionally edit alt texts (warning dots show which are missing) and the album data (popis, SEO).
8. "Zveřejnit album" (status Zveřejněno) then "Zveřejnit web" (F6). Done.

### F2 Reorder
- Photos: drag a tile (desktop: grab the handle or the tile; phone: long press, then drag) to the new place, or lift the handle with the keyboard (Space, arrows, Space). No move buttons (T-243). Order saves instantly, toast "Pořadí uloženo", failure "Pořadí se nepodařilo uložit" with the grid reverting and "Zkusit znovu".
- Albums within a category and categories on the home list work the same way (3.2, 3.3).
- Order changes count as an unpublished change.

### F3 Set cover
- In the album grid: tile menu "Nastavit jako titulní" (or in photo detail). The "Titulní" badge moves, toast "Titulní fotka nastavena." The cover is shown in the category list and used as the Open Graph image of the album unless the SEO spec says otherwise.
- If the cover photo is deleted, the first remaining photo becomes the cover and a toast says so; an album with no photos has no cover and cannot be published (message "Album bez fotek nelze zveřejnit.").

### F4 Hide an album
- Category detail or album screen: "Skrýt album". Light confirmation dialog (no typing): "Skrýt album Novákovi? Z veřejného webu zmizí po dalším zveřejnění. Fotky zůstanou uložené." Buttons "Skrýt album" / "Zrušit".
- Badge changes to "Skryto". "Zveřejnit album" reverses it. Hiding a category hides it and all its albums on the public site (the dialog says how many albums). Same for "Skrýt kategorii".

### F5 Delete with confirmation
- Photo(s): "Smazat fotku" / "Smazat vybrané (5)". Dialog: "Smazat 5 fotek? Fotky se nenávratně smažou z úložiště a nelze je vrátit." Buttons "Smazat" (destructive style) / "Zrušit". Progress "Mažu…", then toast "Smazáno 5 fotek. Uvolněno 12 MB." The storage bar lowers.
- Album: dialog names the album and the number of photos: "Smazat album Novákovi a všech 40 fotek? Tuto akci nelze vrátit." The user must type the album name (or "SMAZAT") to enable "Smazat album". Suggests "Skrýt album" as the alternative link in the dialog.
- Category: allowed only when empty. Otherwise the dialog says "Kategorie obsahuje 4 alba. Nejdřív album přesuňte nebo smažte, nebo kategorii skryjte." (no cascade delete from the UI). Empty category: confirmation dialog without typing.
- Deleting removes the R2 objects (original and all variants) and lowers the total (T-6). Failure to delete storage objects: "Smazání se nepodařilo dokončit." with "Zkusit znovu"; the record is not shown as deleted until the objects are gone (or is marked "Mazání selhalo" so it cannot silently leak storage).
- Public effect after the next publish.

### F6 Publish
1. The dot and "3 změny" on "Zveřejnit web" show that something changed.
2. Open /zverejnit, check the change summary, press "Zveřejnit web".
3. Progress "Web se aktualizuje…" (1 to 2 min), then "Web je aktualizovaný." with "Zobrazit web".
4. On failure the old site keeps serving; retry.

### F7 Other goal flows (short)
- Rename or edit a category: 3.2 menu > "Upravit kategorii" > save.
- Edit album data (title, place, date, description, SEO, slug): 3.4 panel, autosave; slug change warning as in 3.2.
- Move photos to another album: select tiles > "Přesunout do alba" > choose album (list grouped by category, search) > "Přesunout". Order in the target: appended at the end. Storage keys are unaffected (no re-upload).
- Move an album to another category: category detail menu > "Přesunout do jiné kategorie".
- Set alt text and caption: photo detail > fields > "Uložit" (or autosave); bulk hint "12 fotek nemá alternativní text" filters the grid to those.
- Log out: top bar "Odhlásit se".

## 5. Layouts

### Desktop (from 1024 px)
- Top bar fixed. Content max width about 72rem, centred.
- Categories list: single column of wide rows. Category detail: wide album rows with a 96 px cover. Album detail: grid on the left (5 to 6 columns), photo detail panel docked right (24rem) when a photo is selected; metadata panel above the grid, collapsed by default after the first save.
- Upload queue: drawer docked at the bottom right, 24rem wide, collapsible to the summary line; full page at /nahravani.
- Drag and drop with the mouse; keyboard alternatives always present.

### Tablet (640 to 1023 px)
- Grid 3 to 4 columns, photo detail as a modal sheet, queue drawer full width at the bottom.

### Phone (under 640 px)
- Single column, top bar title + overflow menu, bottom navigation (Kategorie, Nahrávání, Zveřejnit).
- Photo grid 2 columns; long press to drag or to enter selection mode; actions in a bottom sheet instead of dropdown menus.
- Photo detail and dialogs full screen; destructive buttons full width and separated from the primary action.
- Upload: "Vybrat fotky" uses the system picker (camera roll, multiple); queue as a full-height sheet; processing in the browser is slower on phones, so the step label "Zpracovávám" must show per-file progress and the page keeps the screen awake where the browser allows it. The doc recommends uploading big batches from a laptop; the phone is for small edits (rename, hide, reorder, alt text, cover).

## 6. Error and progress state catalogue (non-upload)

| Situation | Message (Czech) | Behaviour |
|---|---|---|
| Any load fails | "Nepodařilo se načíst data." | Retry button, page stays usable |
| Save fails (field/form) | "Změny se nepodařilo uložit." | Value kept, retry, no silent loss |
| Offline | Banner "Jste offline. Změny se neuloží." | Actions disabled except reading |
| Slug taken | "Tato adresa je už použitá." | Field error, suggestion with suffix |
| Required field empty | "Vyplňte název." | Field error, focus moves to it |
| Supabase paused / unreachable | "Správa je dočasně nedostupná. Veřejný web funguje dál." | Retry; veřejný web is unaffected |
| Concurrent edit (another tab) | "Toto album bylo změněno jinde. Načíst znovu." | Reload button |
| Long action | Spinner + label ("Mažu…", "Ukládám…") | Buttons disabled, `aria-busy` |

## 7. Czech UI labels (glossary)

Přihlásit se, Odhlásit se, E-mail, Kategorie, Nová kategorie, Album/Alba, Nové album, Fotky, Vybrat fotky, Název, Adresa (slug), Místo, Datum focení, Popis, Popisek, Alternativní text, Pro vyhledávače, SEO titulek, SEO popis, Titulní fotka, Nastavit jako titulní, Zveřejnit album, Skrýt album, Zveřejnit web, Zveřejněno, Koncept, Skryto, Viditelná, Skrytá, Smazat, Zrušit, Uložit, Uloženo, Zkusit znovu, Přesunout, Přesunout do alba, Nahrávání, Ve frontě, Zpracovávám, Nahrávám, Hotovo, Úložiště, Zkontrolovat úložiště, Podrobnosti.
Tone: short, polite, "vy" form, no jargon (not "slug", "URL", "variant": use "adresa", "odkaz", "verze fotky").

## 8. Data and behaviour notes the MASTERPLAN must honour

- Draft vs. public: the admin writes to the database at once; the public site only changes after Publish (rebuild). `albums.published` (and `categories.visible`) set what the build includes. A photo has no own visibility flag in v1; hide an album instead. (Open question for the photographer: does she need to hide single photos? Default: no.)
- Pending-changes count needs a "last published at" marker and `updated_at` on categories, albums, photos.
- Upload sequence: client requests URLs for a batch (server checks quota T-6 and the JWT) > client resizes, uploads variants and original to R2 through the storage adapter > client registers photo rows with byte sizes > server adds sizes to the total. Failed batches leave no orphan rows; orphan objects are found by the reconcile step.
- Delete: removes objects and lowers the total; in the UI the delete is complete only after both.
- No screen exists for page texts (Home, About, Contact, services). Not editable by design.

## 9. Goal mapping (VISION.md goal 3)

Screen ids: S1 Login, S2 Categories list, S3 Category detail, S4 Album detail (grid), S5 Photo detail, S6 Upload queue, S7 Publish, S8 Storage. Flow ids: F1 to F7 as in section 4.

| # | Admin goal (VISION.md goal 3 / T-6) | Screen | Flow |
|---|---|---|---|
| 1 | Log in (one owner, no public sign-up) | S1 | F7 (log out), 3.1 states |
| 2 | Create a category | S2 | F7 |
| 3 | Rename a category | S2 | F7 |
| 4 | Reorder categories | S2 | F2 |
| 5 | Hide a category | S2 | F4 |
| 6 | Delete a category | S2 | F5 |
| 7 | Create an album | S3 | F1 |
| 8 | Edit album title, place, date, description, SEO text, slug | S4 | F7 |
| 9 | Reorder albums | S3 | F2 |
| 10 | Set the cover of an album | S4 (S5) | F3 |
| 11 | Publish / unpublish an album | S3, S4 | F1 (step 8), F4 |
| 12 | Delete an album | S3, S4 | F5 |
| 13 | Upload many photos at once (resized and converted at upload) | S4, S6 | F1 |
| 14 | Reorder photos by drag and drop | S4 | F2 |
| 15 | Set alt text and caption | S5 | F7 |
| 16 | Move photos between albums | S4 (selection), S5 | F7 |
| 17 | Delete photos | S4, S5 | F5 |
| 18 | Changes reach the public site without a developer | S7 | F6 |
| 19 | Simple enough for a non-technical user on a laptop; small edits on a phone | all, section 5 | F1 to F7 |
| 20 | Page texts are not editable (explicitly out of scope) | none (no screen) | none |
| 21 | Storage usage bar, warning at 8 GB, refusal at 9.5 GB, reconcile (T-6) | S8, shell widget, S6 | F1 (step 3), F5, 3.7 |

## 10. Open questions for the photographer (not blockers)

1. Hide single photos, or only whole albums? (Default: albums only.)
2. Should a deleted album go to a trash for 30 days? (Default: no, strong confirmation instead; trash needs delayed object deletion and a cleanup job, which conflicts with "nothing to babysit".)
3. Is automatic first-photo-as-cover acceptable, or must she always pick it? (Default: automatic, changeable.)
4. Are alt texts something she wants to write per photo, or is an album-level alt pattern ("Svatební fotografie, Novákovi, Brno") enough with per-photo override? (Default: pattern + override; MASTERPLAN/SEO.md decides.)
