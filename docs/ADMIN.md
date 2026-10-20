# Admin app

(T-146 completes this file; so far only the sections below: the 21-goal map, the deviations, the accessibility
audit and the browser encode check.)

## The 21 goals and the tests that prove them

The 21 goals are the table in `docs/ADMIN-UX.md` section 9. Every row below names a test file and a `-t` filter;
run one row from the repository root with

```
npx vitest run <test file> -t "<filter>"
```

(for example `npx vitest run apps/admin/src/screens/CategoriesScreen.test.tsx -t "creates a category"`), or a whole
file by leaving `-t` out. Everything runs against the fake world (`VITE_BACKEND=fake` adapters), so no Supabase,
Worker or R2 is needed. `apps/admin/src/a11y/goals.test.ts` checks that every file and filter in this table exists
and that all 21 goals are present, so a renamed test breaks the docs test, not the reader.

| # | Goal | Test file (under `apps/admin/src/`) | `-t` filter |
|---|---|---|---|
| 1 | Log in, one owner, no public sign-up | `auth/auth.test.tsx` | `has the fields, attributes and no registration` |
| 1 | (guard, sign-in, return to the page) | `auth/auth.test.tsx` | `signs in and returns to the page the guard turned away` |
| 2 | Create a category | `screens/CategoriesScreen.test.tsx` | `creates a category` |
| 3 | Rename a category | `screens/CategoriesScreen.test.tsx` | `edits the name and warns before the address changes` |
| 4 | Reorder categories | `screens/CategoriesScreen.test.tsx` | `persists in the fake world` |
| 5 | Hide a category | `screens/CategoriesScreen.test.tsx` | `hiding asks first` |
| 6 | Delete a category | `screens/CategoriesScreen.test.tsx` | `an empty category is deleted after a confirmation` |
| 7 | Create an album | `screens/CategoryScreen.test.tsx` | `creates an unpublished album at the end` |
| 8 | Edit album title, place, date, texts, address | `screens/AlbumScreen.test.tsx` | `saves a changed field once when it loses focus` |
| 9 | Reorder albums | `screens/CategoryScreen.test.tsx` | `persists with the midpoint rule` |
| 10 | Set the cover | `screens/PhotoGallery.test.tsx` | `moves the badge and says so` |
| 11 | Publish / hide an album | `screens/CategoryScreen.test.tsx` | `an album with photos is published` |
| 11 | (hide with confirmation) | `screens/CategoryScreen.test.tsx` | `hiding asks first with the F4 sentence` |
| 12 | Delete an album | `screens/Delete.test.tsx` | `deletes photos first, then the row` |
| 13 | Upload many photos at once | `screens/Upload.test.tsx` | `5 files: step labels in order` |
| 13 | (resize and convert in the browser) | `encode/encode.test.ts` | `files equal planUploadFiles` |
| 14 | Reorder photos (buttons and drag handle) | `screens/PhotoGallery.test.tsx` | `write only sort` |
| 14 | (handle works with the keyboard sensor) | `screens/PhotoGallery.test.tsx` | `every tile has a drag handle that works with the keyboard sensor` |
| 15 | Alt text and caption | `screens/PhotoDetailScreen.test.tsx` | `saves only alt and caption` |
| 16 | Move photos between albums | `screens/PhotoGallery.test.tsx` | `moving 5 photos appends them in order` |
| 17 | Delete photos | `screens/Delete.test.tsx` | `bulk: exact dialog text` |
| 18 | Changes reach the public site (publish) | `screens/PublishScreen.test.tsx` | `full sequence` |
| 19 | Simple on a laptop, small edits on a phone | `a11y/keyboard.test.tsx` | `creates a category and an album` |
| 19 | (phone bottom navigation) | `App.test.tsx` | `phone bottom nav` |
| 20 | Page texts are not editable (no screen) | `a11y/scope.test.tsx` | `the route table is exactly the information architecture` |
| 21 | Storage bar, warning, refusal | `data/storage.test.tsx` | `warn: the sentence with the numbers from the response` |
| 21 | (full level stops uploads) | `screens/Upload.test.tsx` | `level full: both drop zone controls are disabled` |
| 21 | (reconcile, "Součet souhlasí.", confirmed cleanup) | `screens/StorageScreen.test.tsx` | `follows the cursor over two pages` |
| 21 | (breakdown sums to the storage total) | `screens/StorageScreen.test.tsx` | `lists albums biggest first` |

Goal 19 is only partly a unit-test matter (the phone layout and the photographer's own laptop and phone are checked
in `npm run admin-check`, WP5-28, and by the human steps in `docs/VERIFY.md`).

## Deviations from docs/ADMIN-UX.md and the plan

Recorded where the build differs from the spec on purpose. None of them removes a goal.

1. **Inline buttons instead of an overflow menu.** Row actions (rename, hide, delete, move) are visible buttons, not
   a "..." menu, so every action is one Tab stop and needs no pop-up logic. The photo tile does have a menu (a
   dialog, a bottom sheet on a phone) because a tile is too small for several buttons.
2. **Drag by the handle only.** Lists and the photo grid start a drag from the handle (or the long press on a
   phone for selection), never from anywhere on the row, so scrolling and clicking links stay reliable. Every drag
   has buttons and "Přesunout do pozice…" next to it (WCAG 2.5.7).
3. **Two album badges.** Albums show "Zveřejněno" or "Nezveřejněno" only. The database has one `published` flag,
   so "Koncept" (never published) and "Skryto" (hidden after publishing) cannot be told apart without a status
   column. The glossary words stay in the dictionary.
4. **Photo counts by one request per album.** PostgREST aggregates are off on Supabase, so counts (and the storage
   breakdown) come from the photo list of each album, cached by TanStack Query; a screen shows no count while an
   album's photos are still loading. This is also why `/ulozeni` sums `photos.bytes_total` per album itself.
5. **No HEIC library.** HEIC works only where the browser itself decodes it (Safari, recent iOS); elsewhere the
   Czech message "Tento formát fotka v tomto prohlížeči nejde zpracovat. Zkuste ji uložit jako JPEG." appears.
6. **The upload queue is lost on reload.** It lives in memory; `beforeunload` warns while uploads are active.
   Objects of a cancelled or interrupted upload stay in the bucket until "Zkontrolovat úložiště" cleans them up.
7. **The duplicate check is per session.** "Tato fotka už v albu je." compares album, file name and size with the
   files uploaded since the page was opened (forgotten on sign-out), not with photos from earlier sessions. The
   prompt defaults to skipping.
8. **Pending-change wording.** The publish page shows "N úprav od posledního zveřejnění" (a count from
   `site_state.pending_changes`) and the shell shows a dot with "Nezveřejněné změny"; there is no list or summary of
   what changed (ADMIN-UX 3.6 asks for a summary).
9. **Reconcile has no "use the real value" step.** `docs/API.md` removed it: the database total is the sum of the
   photo rows and cannot drift. "Zkontrolovat úložiště" reports orphans, missing objects, size mismatches and unknown
   keys; only orphans can be deleted, in a separate confirmed action ("Smazat nepotřebné soubory", `apply: true`).
   Missing and mismatching files get an explanation but no automatic action. The text "Opraveno: databáze ukazovala …"
   of ADMIN-UX 3.7 does not exist. The check follows the Worker's cursor until it returns none.
10. **Publish status polling.** `/_publish.json` is polled every 5 s for at most 6 minutes. There is no separate
    request timeout (about 10 s was suggested) and no retry of a single failed poll; an unreadable file (CORS)
    degrades to "build triggered".

## Accessibility and keyboard audit (WP5-27)

Audited against ADMIN-UX section 1 and WCAG 2.2 AA. All tests run in `npm test`; the folder is
`apps/admin/src/a11y/`.

| Check | Test |
|---|---|
| axe (WCAG 2.0/2.1/2.2 A and AA tags), zero serious or critical, in 20 screen states and dialogs (404; categories and its four dialogs; category detail and its four dialogs; album, its delete dialog, the tile menu, the move-photo dialog and selection mode; photo detail; publish; storage; upload page), storage in the warning and the full state, the login, the session-expired modal, the upload drawer while uploading and when done, and the duplicate prompt | `a11y/audit.test.tsx` |
| Every dialog hands focus back to its opener (Escape and Cancel), also when a menu opened a second dialog, and to the main region when the opener is gone | `a11y/audit.test.tsx`, group "every dialog returns focus" |
| A keyboard-only session: new category, new album, alt text, move a photo, delete a photo, all with Tab, Enter, Space and typing; focus never on the page body | `a11y/keyboard.test.tsx` |
| `prefers-reduced-motion`: every transition and animation in the CSS sits inside `(prefers-reduced-motion: no-preference)`; with `reduce` the sortable list and the photo grid set no inline transition | `a11y/motion-focus.test.tsx` |
| Focus is not lost when the focused control becomes disabled or is removed | `a11y/motion-focus.test.tsx`, group "focus is not lost" |

Colour contrast is not measurable in jsdom; it is checked by `design-check` and `admin-check` in a real browser.

Findings of the audit and what was done:

- Busy buttons (login, forgot/recovery, every dialog's confirm and Cancel, the photo detail Save) were `disabled`
  while working, which drops keyboard focus to the page body. They use `aria-disabled` now and ignore the press
  while busy; the typed-name field of the album delete dialog is `readOnly` while deleting.
- `components/FocusRescue.tsx` (mounted in `AppProviders`) is the safety net for the rest: a focused control that
  becomes disabled (for instance every action while offline) passes focus to the nearest enabled control, and a
  focused element that is removed (a deleted photo's menu button) passes it to the open dialog or the main region.
- A dialog whose opener no longer exists (the row was moved or deleted) puts focus on the main region instead of
  the page body.
- Renaming an album inline: Enter and Escape put focus back on "Přejmenovat album" (a blur leaves focus alone).
- Already correct and now covered by tests: skip link first, one `h1` and landmarks per route, labelled fields,
  `<dialog>` with Escape, live regions for saving, reordering and uploads, drag alternatives. Target size
  (`--target-min`, 44 px) is a CSS token; its measured result belongs to `admin-check`.

## Browser encode check

`npm run admin-encode-check` runs the real browser encoder (`apps/admin/src/encode`, with `canvasSurface.ts`) in
headless system Chrome on sharp-made fixtures and checks the output. Needs Chrome (`CHROME_PATH`, else the usual
locations); exit 0 pass, 1 fail, 2 skipped without Chrome. Run it alone, never during `npm test`.

Fixtures (generated into the gitignored `.tmp/admin-encode/`): a 4000x3000 JPEG with Exif orientation 6 and a GPS
position (displays as 3000x4000 portrait), JPEGs of 6000x4000, 3000x2000, 1200x800, 600x400 and 300x200 (all with GPS),
a PNG with alpha and a WebP.

Per photo it asserts: the file set equals `planUploadFiles`; magic bytes and blob type match JPEG/WebP; every size is
within 1 px of `variantPlan`; the master is at most 3000 px and never upscaled; Exif orientation is applied (the
portrait stays portrait); no Exif/GPS/XMP/IPTC in the master, the 1600 JPEG and the OG image (also none in the WebPs);
the dominant colour matches `^#[0-9a-f]{6}$`. It prints one table row per photo with the encode time and ends with
`ADMIN_ENCODE: PASS` or `ADMIN_ENCODE: FAIL`. `--break-exif` injects an Exif+GPS segment into every produced 1600 JPEG
and must make the run fail (exit 1). `--out <dir>` keeps the produced files for a look.

First real run (2026-10-20, headless Chrome on macOS, `ADMIN_ENCODE: PASS`, `--break-exif` exits 1):

```
fixture              source              master     1600       og        webp tiers             files  magic     exif/gps  colour   ms   result
exif-portrait.jpg    3000x4000 (exif 6)  2250x3000  1600x2133  1200x630  480/720/960/1600       7/7    jwwwwjj   none      #848175  317  ok
photo-6000x4000.jpg  6000x4000           3000x2000  1600x1067  1200x630  480/720/960/1600/2400  8/8    jwwwwwjj  none      #827f74  399  ok
photo-3000x2000.jpg  3000x2000           3000x2000  1600x1067  1200x630  480/720/960/1600/2400  8/8    jwwwwwjj  none      #827f74  312  ok
photo-1200x800.jpg   1200x800            1200x800   1200x800   1200x630  480/720/960            6/6    jwwwjj    none      #838075  66   ok
photo-600x400.jpg    600x400             600x400    600x400    600x315   480                    4/4    jwjj      none      #838076  16   ok
photo-300x200.jpg    300x200             300x200    300x200    300x158   480                    4/4    jwjj      none      #838075  10   ok
alpha.png            1500x1000           1500x1000  1500x1000  1200x630  480/720/960            6/6    jwwwjj    none      #a19d92  69   ok
photo.webp           1800x1200           1800x1200  1600x1067  1200x630  480/720/960/1600       7/7    jwwwwjj   none      #827f74  147  ok
peak time per photo: 399 ms (photo-6000x4000.jpg); total 1336 ms
```

The encoder needed no fix: orientation, `convertToBlob` types, OffscreenCanvas drawing and quality all behaved. Only
the `createImageBitmap` decode path is exercised here (the `<img>` fallback is not).
