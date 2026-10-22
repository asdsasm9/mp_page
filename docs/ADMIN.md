# Admin app

The photographer's tool for categories, albums and photos (`apps/admin`, Vite + React 18, Czech UI). Spec:
[ADMIN-UX.md](ADMIN-UX.md) (built as described there except for the deviations below). Worker contract:
[API.md](API.md), Worker deploy: [DEPLOY-API.md](DEPLOY-API.md), public site: [WEB.md](WEB.md), unconfirmed platform
facts and human steps: [VERIFY.md](VERIFY.md). Page texts (Home, About, Contact) are not editable here.

## Architecture

- A static single-page app. It talks to three services only: Supabase (auth, and PostgREST reads and writes of
  categories, albums and photo metadata with her JWT and the anon key), the API Worker (`VITE_API_BASE_URL`: photo
  upload slots, commit, delete, publish, storage and reconcile) and R2 (direct `PUT` of the encoded files to the
  presigned URLs the Worker hands out). It also reads `<site>/_publish.json` to follow a publish.
- The browser resizes and converts photos before upload (`src/encode`): master up to 3000 px, WebP tiers 480 to 2400,
  a 1200x630 OG image, EXIF and GPS removed, dominant colour computed. See "Browser encode check" below.
- Every adapter (auth, data, upload, publish, storage) has a real and a fake implementation behind one interface in
  `src/adapters`. `VITE_BACKEND=fake` swaps in an in-memory world; the fake build carries the marker
  `MP_ADMIN_FAKE_WORLD_7f3a9c`, which a gate keeps out of any production build.
- No service-role key, no sign-up, no direct writes to `photos` (the Worker does that), no R2 host in the source, no
  hard-coded limits (they come from the Worker's `app_config`). `npm run gates` enforces this (section "Security gates").

### Routes

| Route | Screen |
|---|---|
| `/prihlaseni` | Sign in with Google, and the return point of the Google round trip (the only public route) |
| `/` | Categories |
| `/kategorie/:id` | One category and its albums |
| `/alba/:id` | One album and its photos |
| `/alba/:id/foto/:photoId` | Photo detail (alt text, caption) |
| `/zverejnit` | Publish the site |
| `/ulozeni` | Storage and reconcile |
| `/nahravani` | Upload page (the queue also shows as a drawer) |
| `*` | 404 |

`a11y/scope.test.tsx` fixes this table as the information architecture; there is no pages or settings screen.

### Environment variables

All are build-time (`VITE_*`, baked into the bundle, so they are public; the anon key is meant to be public). Names
only live in `.env.example` (class 2, five URLs plus the anon key, and `VITE_BACKEND`; the gate `env-example-complete` keeps it equal to the code); real values go into the Cloudflare Pages project settings, never into the repo. In real
mode a missing or malformed value makes the app show "Správa není nastavená" with the variable names (never values).

| Name | Meaning |
|---|---|
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the anon (publishable) key, never the service-role key |
| `VITE_API_BASE_URL` | origin of the API Worker (`docs/DEPLOY-API.md` section 8) |
| `VITE_IMG_BASE_URL` | public photo host (the same as `R2_PUBLIC_BASE_URL` of the Worker and `PUBLIC_IMG_BASE_URL` of the web) |
| `VITE_PUBLIC_SITE_URL` | public site origin, where `/_publish.json` is read |
| `VITE_R2_UPLOAD_ORIGIN` | origin of the presigned upload URLs (`https://<account-id>.r2.cloudflarestorage.com`, or the bucket host in use) |
| `VITE_BACKEND` | `real` (default, unset) or `fake` (in-memory; tests and autopilot only, never in production) |

The five URLs also decide the CSP (section "Production build, CSP and bundle budget"): they become the allowed origins.
On the public web project the one related variable is `PUBLIC_ADMIN_ORIGIN` (`docs/WEB.md`).

### Fake mode

Starting the Vite dev server with `VITE_BACKEND=fake` set in the environment (the checks below set it themselves)
runs the app against an in-memory world. The seeded accounts are in `apps/admin/src/adapters/fake/auth.ts` (test
data only, not real credentials). Nothing leaves the browser. All unit tests use it, so `npm test` needs no services.
The fake publish builds its snapshot with an empty `urlHistory` (the fake world keeps no slug history), whereas the real Worker passes the real rows, so old-URL redirects are not exercised in fake mode.

## Deploying the admin (human steps)

Nothing here was run by the builder (no Cloudflare or Supabase login). Do the Worker first (`docs/DEPLOY-API.md`),
because the admin needs its origin. Dashboard menu names are from memory and may have moved. Use a stable admin
origin, for example `https://admin.mullnyphotos.cz`; a Pages preview URL changes with each deploy and would never
match the CORS and redirect lists below.

1. **Pages project.** In Cloudflare, Workers & Pages, create a Pages project from the git repository (or upload
   `apps/admin/dist`). Build command `npm run build -w apps/admin`, output directory `apps/admin/dist`, root the
   repository root, Node version from `.nvmrc` (`NODE_VERSION` variable if needed). Add the custom domain.
2. **Environment variables** (Settings, Variables, production): the five URLs plus the anon key (six `VITE_*` values) from the table above;
   leave `VITE_BACKEND` unset. They are read at build time, so a change needs a new deployment. Set the same
   variables for the preview environment only if previews are used.
3. **Check the build output.** `dist/_headers` (CSP and cache rules, generated) and `dist/_redirects`
   (`/* /index.html 200`, the SPA fallback) must be in the deployment. A deep link such as `/zverejnit` must open the app
   (VERIFY row 31).
4. **Worker and bucket.** Add the admin origin to the Worker's `ALLOWED_ORIGINS` and to the R2 bucket CORS policy
   (`docs/DEPLOY-API.md` sections 5 and 6; the policy allows `PUT` with `content-type`, `content-length`,
   `cache-control`). Without the R2 CORS entry every upload fails in the browser (VERIFY row 27).
5. **Google sign-in and Supabase** (WP-09; the admin has no password of its own). Do the sub-steps in this order;
   V-1 to V-12 are rows 37 to 48 of [VERIFY.md](VERIFY.md) (V-0 is a question, not a row;
   rows 5, 32 and 36 were rewritten for this). Dashboard menu names are from memory. Never paste the Google client secret into chat, a file or the
   repository: it goes straight into the Supabase dashboard and nowhere else. Never write a real e-mail address into
   a file in the repository; the examples use `<lowercase address 1>` and `<lowercase address 2>`.
   - **V-0 Path question (2 min).** Were the live Supabase migrations pushed, were password users created, is an old
     admin build deployed? If nothing is live (the README says so), this single-migration path applies: nothing to keep
     working, nothing to lock out. If a live password user exists, stop and ask for the two-step (expand, then contract)
     path before going on.
   - **V-1 Google Cloud (Adam, about 10 min).** Sign in with Adam's Google account (2-step verification on). Create the
     project "mullnyphotos-admin" without a billing account. Google Auth Platform: user type External, app name
     "Mullny Photos správa", support and developer e-mail Adam's, scopes only `openid`, `email` and `profile`,
     publishing status **Testing**, test users the photographer's Gmail and Adam's Gmail. Credentials, OAuth client ID,
     Web application: one authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`
     (the Supabase project's own callback URL, copied from the Supabase provider page), JavaScript origins empty. Copy the client ID and
     secret straight into Supabase (V-2). Optional: add the photographer as a second Owner of the project.
   - **V-2 Supabase dashboard (Adam, about 5 min).** Authentication, Providers, Google: enable, paste ID and secret,
     check that the callback URL shown equals the one in V-1. URL Configuration: Site URL
     `https://admin.mullnyphotos.cz`; Redirect URLs exactly `https://admin.mullnyphotos.cz/prihlaseni`, plus one exact
     Pages preview URL `https://<branch>.<pages-project>.pages.dev/prihlaseni` until the cutover (no localhost, no
     wildcard in production). Sign-ups stay off. The Email provider stays on until V-11.
   - **V-3 Database.** `supabase db push` applies `supabase/migrations/20261022100000_admin_google_signin.sql`
     (the `admin_emails` allow-list, the Google-only `is_admin()`, and the old `admins` table dropped). Then, in the
     SQL editor: `insert into public.admin_emails (email) values ('<lowercase address 1>'), ('<lowercase address 2>');`.
     Copy each address exactly as Authentication, Users shows it, in lower case (`googlemail.com` is a different
     string from `gmail.com`). Then Authentication, Users, "Add user" for each address (auto-confirm, a random password
     nobody will use) unless the user already exists with that exact e-mail.
   - **V-4 Does it work with sign-ups off? (TO VERIFY, decides the variant).** First sign-in with Adam's account on the
     preview URL. Expected: signed in, and the Users page shows a Google identity on the same user. If Supabase
     answers with a sign-up error, use the fallback: switch sign-ups on for a few minutes, do the two first sign-ins
     (in Testing mode only the two test users pass Google), switch sign-ups off again.
   - **V-5 Adam on the preview.** Sign in; a third Google account is refused by Google (Testing mode) or shows the
     denial text, and `select public.is_admin();` is false for it; a `curl` to `<supabase>/auth/v1/signup` is refused;
     create content and publish.
   - **V-6 Photographer on her own devices.** Sign in, read the Google consent screen (note any "unverified app"
     warning and decide Testing versus production mode), try cancelling once, sign out.
   - **V-7 Production origin.** Both admins sign in on `https://admin.mullnyphotos.cz`; no CSP violation in the browser
     console; record the CSP header (it is unchanged and contains no `google`).
   - **V-8 Session refresh.** After more than one hour the app still works without a prompt; record the access-token
     lifetime and whether the "Přihlášení vypršelo" dialog ever appeared.
   - **V-9 Callback robustness.** Open `/zverejnit` while signed out; after Google the app returns there.
   - **V-10 2-step verification.** Both owners switch on 2-step verification on their Google account
     (`https://myaccount.google.com/security`) and record the date. This is a human attestation: see "What the app cannot enforce" below.
   - **V-11 Final cutover (at deploy).** Disable the Email provider and remove the preview URL from the redirect
     list. A password sign-in with `curl` must now be refused and Google sign-in must still work.
   - **V-12 Supabase Auth rate limits.** Record the OAuth, token and sign-in per-IP limits with the date.

   Hard rules: never disable the Email provider before V-7 and V-8 passed; never leave the project with zero listed
   addresses; Adam keeps his own Supabase login with 2-step verification. Lost access is in
   [MAINTENANCE.md](MAINTENANCE.md).
6. **Public site.** On the web Pages project set `PUBLIC_ADMIN_ORIGIN` to the exact admin origin (no path, no trailing
   slash) and redeploy, so the admin may read `/_publish.json` (`docs/WEB.md`, VERIFY row 28).
7. **First run.** Sign in, create a test category and album, upload 3 photos, publish. Then do VERIFY rows 25 to 32
   that apply. Nothing in the repo may contain the real values; `npm run gates` checks the built bundle for keys.

If the CSP blocks something after deploy, the browser console names the blocked origin; fix the matching `VITE_*`
value and rebuild (the five origins in `connect-src` / `img-src` must equal what the app really calls).

### What the app cannot enforce

The admin has no password. Whoever controls an allow-listed Google account is the admin, so the Google account is the
only lock. Google 2-step verification (2SV) is a second factor only if the owner has switched it on for that account.
The app cannot enforce it and cannot detect it: it only sees a signed-in Google identity. That is why the sign-in card
carries a tip, [NAVOD.md](NAVOD.md) explains how to switch it on, and V-10 records the date both owners did it as a
human attestation. Keep the allow-list to the two addresses. TOTP in Supabase (and an `aal2` check in `is_admin()` and
the Worker) remains a possible later hardening (VERIFY row 5), not part of this build.

### Which personal data Google passes to Supabase

When one of the two admins signs in, Google gives Supabase the account's e-mail address, a flag that the address is
verified, the display name and the address of the profile picture (scopes `openid`, `email`, `profile` only). Supabase
Auth (EU region) stores them in its `auth.users` and `auth.identities` tables; the allow-list holds the e-mail address
too. Nothing else is requested, and Google never passes the Google password. The public site and its visitors are not
involved. People outside the two addresses leave data only in the short fallback window of V-4, if it is needed.

## Using it: short guide for the photographer (Czech)

Podrobný návod krok za krokem je v [NAVOD.md](NAVOD.md).

Přihlášení: otevři adresu správy a klikni na „Přihlásit se přes Google“. Přihlásit se dá jen povoleným účtem Google (dva
účty). Žádné heslo do správy neexistuje. Zapni si v účtu Google dvoustupňové ověření; správa ho nevynutí a nepozná, jestli
ho máš. Na sdíleném počítači se odhlas i z Googlu.

- **Kategorie** (úvodní stránka): „Nová kategorie“, přejmenování, skrytí, smazání a pořadí. Pořadí měníš šipkami nebo
  přetažením za úchyt vlevo.
- **Album**: v kategorii „Nové album“. Vyplň název, místo, datum a text. Album je nejdřív „Nezveřejněno“.
- **Fotky**: v albu přetáhni fotky do okna nebo klikni na „Vybrat fotky“. Aplikace je sama zmenší. Pokud se fotka
  nenahraje, klikni na „Zkusit znovu“. Zavřít stránku během nahrávání nejde bez varování; po obnovení stránky se
  fronta ztratí a chybějící fotky se nahrají znovu.
- **Titulní fotka, pořadí, přesun, smazání**: v nabídce u každé fotky. Podrobnosti fotky: popisek a alternativní text.
- **Zveřejnit web**: všechny úpravy se ukládají hned, ale návštěvníci je uvidí až po „Zveřejnit web“ (chvíli to trvá, stránka ukazuje průběh).
  Tečka s popiskem „Nezveřejněné změny“ říká, že na webu ještě nejsou všechny úpravy.
- **Úložiště**: ukazuje, kolik místa zbývá. Při varování zbývá málo, při plném úložišti se nahrávání zastaví. Tlačítko
  „Zkontrolovat úložiště“ najde zbytky po přerušeném nahrávání a po potvrzení je smaže.
- Texty stránek (Domů, O mně, Kontakt) se tady nemění; ty upravuje správce webu.
- Něco nejde? Poznamenej si, co jsi dělala a co se zobrazilo, a napiš správci webu.

## Check commands

Browser checks need Chrome, run one at a time and never during `npm test` (details further down):

| Command | Proves |
|---|---|
| `npm test`, `npm run typecheck`, `npm run gates` | units (fake world), types, repository and security gates |
| `npm run admin-encode-check` | the real in-browser encoder on fixtures |
| `npm run admin-check` | the full flow in a real browser against the fake world, a11y, targets, console |
| `npm run admin-prod-check` | the production bundle with the generated CSP against mock origins |
| `npm run design-check` | the visual check (screenshots, axe, Lighthouse) |

## Security gates

`npm run gates` (`scripts/gates.mjs`, tested by `scripts/gates.test.mjs`) scans `apps/admin/src` (not tests, not
`src/a11y/`) for: `service_role` / service key names, sign-up calls (`signUp`, `auth/v1/signup`, `auth.admin`,
`createUser`), HTML injection (`dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, `document.write`,
`eval`, `new Function`), direct writes to `photos`, R2 hosts and SDKs, and hard-coded limits (8 GB, 10 GB, 12 MB).
When a production build exists on disk (`apps/admin/dist` or `.tmp/admin-prod/site`) it also scans the built files for
the fake-world marker, key-like strings (JWT, `sk_`, AWS ids, private keys, long secret values) and for any URL host
that is neither a known library host nor a host in the current `VITE_*_URL` / `*_ORIGIN` environment. With no build the
dist rules print SKIP; they are not made on the fly.

Known evasions (the gates are pattern checks, a guard against mistakes, not a proof):

- Anything built at run time slips through the source rules: `'pho' + 'tos'`, `el['inner' + 'HTML']`,
  `window['ev' + 'al']`, a limit written as `1e10`, `10 * 1000 ** 3` or `10_000 * 1_000_000`.
- Aliased imports or helper wrappers around the `photos` write patterns; only the literal `'photos'` next to
  `insert/delete/upsert` or `from('photos')` is seen.
- Only `.ts` and `.tsx` files under `apps/admin/src` are scanned; a `.js`, `.mjs` or JSON file, or code outside that
  folder, is not.
- Dist host check: protocol-relative `//host` URLs and hosts assembled from parts are not matched; the allowed list is
  taken from the environment of the run, so with the `VITE_*` values unset it is stricter, and a host that is also a
  library host (for example `github.com`) is always allowed. Key checks match known shapes only; an unusual key format
  or an encoded one (base64, split) is not found.
- The dist rules only run when a build is on disk; a clean `npm run gates` before any build says SKIP, not PASS.

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
| 14 | Reorder photos (drag only, no move buttons) | `screens/PhotoGallery.test.tsx` | `writes only sort` |
| 14 | (the tile menu has no move buttons) | `screens/PhotoGallery.test.tsx` | `the tile menu has no move-to-start` |
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
   **Icon buttons (T-244, 2026-10-22).** In the category and album rows the buttons are icon-only: edit (pencil),
   hide (crossed eye) or show (eye), publish (arrow up to a tray), move (folder with arrow) and delete (trash).
   Icons are **inline SVG** from one small shared component, `apps/admin/src/components/IconButton.tsx` (24 x 24
   strokes in `currentColor`, about 2 KB of source, no dependency, no icon font, no emoji); a library such as
   lucide-react was not added because a new dependency needs a human decision. Size and stroke come from the tokens
   `--icon-size` and `--icon-stroke`. Each button has a Czech accessible name (`aria-label`, the same
   "Akce: název" text as before) plus the same text as `title` tooltip, and the 44 px target of `.button`
   (`--target-min`, square). Delete is demoted to a quiet danger-coloured icon without a border and still opens the
   confirm dialog. Kept as text: "Otevřít" (navigation), the page-header buttons and the photo tile menu (a sheet of
   labelled actions), where a visible word is clearer than an icon.
2. **Reordering is drag only (T-243, Adam's decision 2026-10-22).** Lists and the photo grid start a drag from
   the handle (or the long press on a phone for selection), never from anywhere on the row, so scrolling and
   clicking links stay reliable. The text buttons "Posunout nahoru / dolů", "Posunout na začátek / na konec" and
   "Přesunout do pozice…" were removed for albums, categories and photos. Keyboard users keep the handle with the
   dnd-kit keyboard sensor (Space or Enter lifts, arrows move, Space or Enter drops, Escape cancels; Czech
   instructions and polite announcements). WCAG 2.5.7 (Dragging Movements) asks for a single-pointer alternative to
   dragging; there is none now, which is a conscious deviation. The keyboard path covers keyboard users, but a
   pointer user who cannot drag has no alternative. Revisit if that user group matters.
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
11. **Zod runs in `jitless` mode.** Zod 4 probes dynamic code compilation, which the admin CSP (no `unsafe-eval`)
    refuses and reports as a violation on every load. `src/zodCsp.ts` sets `jitless` first, so validation is slightly
    slower and the CSP stays free of `unsafe-*`. `zod` is a direct dependency of `apps/admin` for this reason
    (section "Production build, CSP and bundle budget").
12. **The public site origin is in `connect-src`.** Plan 4.1 listed Supabase, the Worker and R2 only; the publish
    screen reads `<site>/_publish.json` from script, so `VITE_PUBLIC_SITE_URL` is allowed too (exactly that origin).
13. **Security gates are pattern checks with known evasions** (run-time built strings, aliasing, non-`.ts` files,
    protocol-relative hosts, dist rules skipped without a build); see "Security gates".
14. **No real-device or live-service proof.** Phone layout, Safari/Firefox WebP, phone
    memory, live Supabase, R2 and Worker behaviour are covered by mocks and Chrome only; the open items are
    `docs/VERIFY.md` rows 4, 5, 9 and 25 to 32.

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

- Busy buttons (login, every dialog's confirm and Cancel, the photo detail Save) were `disabled`
  while working, which drops keyboard focus to the page body. They use `aria-disabled` now and ignore the press
  while busy; the typed-name field of the album delete dialog is `readOnly` while deleting.
- `components/FocusRescue.tsx` (mounted in `AppProviders`) is the safety net for the rest: a focused control that
  becomes disabled (for instance every action while offline) passes focus to the nearest enabled control, and a
  focused element that is removed (a deleted photo's menu button) passes it to the open dialog or the main region.
- A dialog whose opener no longer exists (the row was moved or deleted) puts focus on the main region instead of
  the page body.
- Renaming an album inline: Enter and Escape put focus back on "Přejmenovat album" (a blur leaves focus alone).
- Already correct and now covered by tests: skip link first, one `h1` and landmarks per route, labelled fields,
  `<dialog>` with Escape, live regions for saving, reordering and uploads, the keyboard sensor on every drag
  handle (the move buttons were removed in T-243, see deviation 2 for WCAG 2.5.7). Target size
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

## Full-flow browser check (WP5-28)

`npm run admin-check` builds `apps/admin` with `VITE_BACKEND=fake` into the gitignored `.tmp/admin-check/site` (never
into `apps/admin/dist`), serves it from a local static server with SPA fallback and drives system Chrome
(puppeteer-core) through the fake world at desktop 1280 and phone 390 (touch emulation, `isMobile`). Exit 0 pass,
1 fail, 2 skipped without Chrome. Run it alone, never during `npm test`. Options: `--out <dir>` (screenshots, default
`.tmp/admin-check/shots`; the paths are printed), `--no-build` (reuse the last build), `--break button,origin,axe`
(deliberately break the page; the run must exit 1).

Flows (docs/ADMIN-UX.md): the Google login with injected failures (offline, cancelled at Google, an account that is not allowed), create a
category and an album (F1, F4), upload 5 generated JPEGs through the real in-browser encoder with one PUT failing once,
tile menu and photo detail with alt text and caption saved (F7), set cover (F3), reorder by dragging a tile (F2), delete a photo
(F5), publish and hide the album (F4), publish the site with one injected failure first (F6), storage screen with
reconcile, sign out. Phone also visits every route at 320 px.

At every page and state it asserts: axe-core (wcag2a/2aa/21/22aa tags, colour contrast on; serious and critical fail),
no horizontal overflow, interactive targets at least 44 px on the phone and 24 px on the desktop (inline links in a
sentence are exempt), a clean console (no errors, warnings, page errors, failed or 4xx/5xx requests), an origin
allowlist (only the page's own origin, `data:` and `blob:`) and the worst layout-shift window at most 0.1. The pure
judges live in `scripts/admin-check-lib.mjs`; `scripts/admin-check.test.mjs` runs them on synthetic input and, with
`ADMIN_CHECK_BROWSER=1`, proves that a 30 px button, a fetch to another origin and an axe violation each make the real
run exit 1. Not covered (the fake world has no network): CSP, real Supabase/Worker/R2 timing, real image hosts (photo
URLs are answered with a placeholder from the same origin).

What the first real-browser run found, all fixed in `apps/admin` and guarded by
`apps/admin/src/styles/browser-findings.test.ts`:

| Finding | Fix |
| --- | --- |
| `/favicon.ico` 404 showed as a console error on every load | inline `data:` icon in `index.html` |
| Desktop top bar wrapped to two rows at 1280 px ("Odhlásit se" alone on the second row) | tighter nav link padding, no gap in the link list, smaller header gap |
| Phone top bar used three mostly empty rows | brand and sign-out on one row, storage and queue below |
| Collapsed upload queue (fixed, bottom right) covered the "Zpět na album" link and tiles at the bottom; scrolling parked controls under it | room under `.shell-main` and `scroll-padding-block-end` while the queue exists |
| "Zpět na album" link 18 px high; list titles (categories, albums) 26 px high on the phone | whole-line links and `.row-title` get the 44 px target |
| Storage table links of short album names ("Mia", "Pati", "Anež") only 28 to 39 px wide on the phone | `min-inline-size: var(--target-min)` |
| Closed `<details>` ("Pro vyhledávače") looked like a plain label: `display:flex` had removed the marker | CSS chevron that turns when open |
| "Zkontrolovat úložiště" button touched its intro line and the result box | spacing in sections with a heading |

Open observations (not changed): the upload queue stays open after a batch until it is collapsed (by design, 3.5),
and its top-bar button then reads "Nahrávání: 0". The accent button colour is a muted tan; brand colour stays H-3.

Final run (2026-10-20, headless Chrome on macOS, fake world), `ADMIN_CHECK: PASS`, 57 page states:

| Profile | States checked | axe serious/critical | Overflow | Smallest target | Console and requests | Worst layout shift |
| --- | --- | --- | --- | --- | --- | --- |
| desktop 1280 | 25 | 0 | 0 px | 44 px | 0 messages, 16 requests, all same origin | 0.032 |
| phone 390 (+320 sweep) | 25 (+7 at 320) | 0 | 0 px | 44 px | 0 messages, 16 requests, all same origin | 0.074 |

Timing note (no Lighthouse, fake backend, headless): first contentful paint 92 ms desktop / 68 ms phone, largest
contentful paint 108 / 84 ms; encoding and fake-uploading 5 photos takes 2.9 s desktop / 3.1 s phone (phone encodes one
photo at a time); a publish with a 1.5 s fake build takes about 6 s because the status is polled every 5 s. Initial JS is
520 kB (159 kB gzip) plus 223 kB (58 kB gzip) for the adapter chunk of this fake build; the real budget belongs to WP5-29.

### Design pass (WP-08a, T-173 to T-180)

A CSS-only pass over `apps/admin/src/styles/app.css` to give the tool a clearer hierarchy. No token value, new token,
markup, class name, route, role or Czech text changed; brand colour (H-3), dark mode and fonts are untouched. Guarded by
`apps/admin/src/styles/design-pass.test.ts` (no literal colours or px in `app.css`, plus one check per step below).

- Type and rhythm (step 2): h1 is `--font-size-2`, h2 gets a rule at `--font-size-1`, and h2 in a page or section has
  `--space-6` space above, so sections separate. The header row still fits one line at 1280.
- Surfaces and tables (step 3): `.panel`, `.storage-large`, `.finding` and `.publish-card` use the `.card` recipe
  (`--shadow-sm`); table header cells are muted and small, and body rows highlight on hover.
- Buttons and badges (step 4): "Smazat album" in the page header is an outline button with danger text; the solid red
  stays only inside confirm dialogs. Row buttons are transparent with a surface hover, badges get a fill per
  `data-state` (text stays the signal), `.button:active` darkens without moving.
- Forms and login (step 5): the login card is clear of the top edge, inputs darken their border on hover; the 3 px
  focus ring is unchanged.
- Photo grid and upload (step 6): tile controls and badges carry `--shadow-sm`, a hovered tile `--shadow-md`;
  dropzone and upload-row spacing use `--space-*`; the gallery toolbar wraps with a gap on the phone.
- Phone and shell (step 7): the row actions have a top divider, the active bottom-nav item is clearer (still 44 px),
  and the shell header has `--shadow-sm`. Since T-245 the header is sticky (see "Sticky header" below).

### Sticky header (T-245, 2026-10-22)

- `.shell-header` is `position: sticky; inset-block-start: 0; z-index: var(--z-header)`. Dialogs (`--z-dialog`) and the
  skip link (`--z-skip`) stay above it.
- `html` has `scroll-padding-block-start: var(--header-height)` (4.5rem, one-row bar at 1280 px and wider) and
  `var(--header-height-wrapped)` (8rem) below 80rem, where the bar wraps to two rows (measured 113 px at 360 and 768 px,
  61 px at 1280 px). So anchors, `scrollIntoView` and a field that gets focus land below the bar and are never fully
  covered (WCAG 2.4.11 Focus Not Obscured). `admin-check` has a "sticky header" step that scrolls down, focuses the
  first control of the page and asserts it sits below the bar, that the bar is sticky and stays at the top.
- "Úložiště" is no longer in the header navigation (desktop). The storage bar in the header (and the large bar on the
  categories screen) is the link to `/ulozeni`; there is no text link in the phone bottom navigation either.
- `admin-check` profiles are now desktop 1280, tablet 768 and phone 360. Each checkpoint measures from the top of the
  page (scroll reset), so a control that merely sits under the sticky bar at a leftover scroll position is not judged.
- Motion: only border-color, box-shadow and background-color transitions, all inside `prefers-reduced-motion: no-preference`.

Measured 2026-10-20 (headless Chrome on macOS, after step 7): `npm test` 133 files, 2427 passed, 5 skipped;
`npm run typecheck` and `npm run gates` clean; `ADMIN_CHECK: PASS` on 57 page states (25 desktop 1280, 25 phone 390,
7 at 320) with 0 axe serious/critical, 0 px overflow, smallest target 44 px, 0 console messages, worst layout shift
0.031 desktop / 0.074 phone; `ADMIN_PROD_CHECK: PASS` (0 CSP violations, JS 210.2 kB gzip unchanged, CSS 4.6 to
4.9 kB gzip, +0.3 kB against the 1 kB allowance, 50 kB limit); `DESIGN_CHECK: PASS` (apps/web, unaffected). The
before/after screenshots are in the gitignored `.tmp/admin-check/shots`.

Open observations above: both stay open (the pass changed neither the upload queue behaviour nor the brand colour).

## Production build, CSP and bundle budget (WP5-29)

`npm run build -w apps/admin` emits `dist/_headers` next to `index.html` (Vite plugin `admin-headers` in
`apps/admin/vite.config.ts`, text from `apps/admin/headers.ts`). The CSP is built from the build-time `VITE_*` origins,
so it changes with the env and never contains a wildcard or `unsafe-*`:

| Directive | Value |
| --- | --- |
| `default-src` | `'none'` |
| `script-src`, `style-src` | `'self'` |
| `img-src` | `'self' blob: data:` + origin of `VITE_IMG_BASE_URL` |
| `connect-src` | origins of `VITE_SUPABASE_URL`, `VITE_API_BASE_URL`, `VITE_PUBLIC_SITE_URL`, `VITE_R2_UPLOAD_ORIGIN` (`'none'` when the env is empty) |
| `base-uri`, `object-src`, `frame-ancestors` | `'none'` |
| `form-action` | `'self'` |

Also `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
`X-Robots-Tag: noindex, nofollow`, a locked-down `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`;
`/assets/*` is `immutable` for a year, `/` and `/index.html` are `no-cache`.

Deviation from plan 4.1: `connect-src` also lists the public site origin, because the publish screen reads
`<site>/_publish.json` (WP5-25) from script. The origin is exactly `VITE_PUBLIC_SITE_URL`.

`zod` is now a direct dependency of `apps/admin` (same version 4.6.7 as `packages/shared`, no new bytes): Zod 4 probes
dynamic code compilation while schemas are built, which the CSP refuses and reports as a violation on every load.
`src/zodCsp.ts` (first import of `main.tsx`) sets `jitless`, so the probe never runs.

`npm run admin-prod-check` (alone, never during `npm test`; exit 0 pass, 1 fail, 2 skipped without Chrome) builds the
production bundle (real adapters, `VITE_BACKEND` unset) into the gitignored `.tmp/admin-prod/site` with the five origins
pointing at mock servers on localhost ports (Supabase auth and PostgREST, Worker, image host, public site, R2), serves
it with the generated `_headers` and drives Chrome: sign in, categories, publish, storage. It fails on any
`securitypolicyviolation`, console error or warning, request outside the page and the mocks, a document without the
hardened CSP/noindex headers, or JS over budget. Probes prove the policy is enforced: the five allowed origins work
(fetch x3, XHR PUT to R2, image), and a foreign fetch, a foreign image and an inline script are each reported as a
violation. The pure judges are in `scripts/admin-prod-check-lib.mjs` (`scripts/admin-prod-check.test.mjs`).

Bundle budget: JS fetched at start-up under 300 kB gzip (CSS under 50 kB gzip). Measured 2026-10-20: entry chunk
508.4 kB raw / 154.0 kB gzip, real-adapter chunk (supabase-js, always fetched) 217.6 kB raw / 56.2 kB gzip, total
726 kB raw / 210.2 kB gzip; CSS 23.6 kB raw / 4.6 kB gzip. Vite's raw 500 kB chunk warning is raised to 600 kB
(`build.chunkSizeWarningLimit`) because the gzip budget is the real constraint. This is above the 170 kB gzip default
of the perf-budget skill for public pages; the admin is a logged-in tool used by one person, so routes are not split
yet. Proposed follow-up if the number grows: `React.lazy` for the storage, publish and photo-detail screens.
