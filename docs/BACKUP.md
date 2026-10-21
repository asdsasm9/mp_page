# Backup and restore

Nothing described here was run against a live service (Supabase, R2, the image host). Both tools are tested offline with fakes and an in-memory Postgres only. The first real run is a human step: see [VERIFY.md](VERIFY.md) (row 37 for the SQL trigger switch; rows 11 and 30 for the Supabase pause).

## What is protected, and what is not

| Data | Protected by | Notes |
|------|--------------|-------|
| Catalog (categories, albums, photos, url_history) | The Worker writes `full-<timestamp>.json` to the private backup bucket on every publish and keeps the newest 20 | Automatic, catalog only. Table meanings: [DATA-MODEL.md](DATA-MODEL.md) |
| Catalog and masters on your own disk | `npm run backup` | Manual. Run it yourself (see cadence below) |
| New photo bytes (masters) | Nothing automatic | There is no automatic second copy of new photo bytes. Until you run `npm run backup`, a new master exists once, in the photo bucket |
| Variants (WebP tiers, 1600 JPEG, OG image) | Not backed up | Regenerable from the masters |
| Users, `admins` rows, Supabase auth | Not backed up | Recreated by hand, [ADMIN.md](ADMIN.md) step 5 ("Deploying the admin") |

Rolling 20 `full-*.json` files are snapshots in time: a bad publish pushes older ones out only after 20 more publishes.

## `npm run backup`

Read-only towards Supabase and the image host. It never writes to a live service and holds no R2 credentials.

```
npm run backup -- --out <dir> [--live] [--dry-run] [--update] [--max-photos <n>] [--max-bytes <n>]
```

| Flag | Meaning |
|------|---------|
| `--out <dir>` | Required. Where the backup goes |
| `--dry-run` | Print the plan and touch nothing. This is the default; nothing is contacted without `--live` |
| `--live` | Really read Supabase and the image host. Cannot be combined with `--dry-run` |
| `--update` | Accept a non-empty `--out` that holds files other than `catalog.json`, `manifest.json`, `masters/` |
| `--max-photos <n>` | Refuse when the catalog has more photos (default 2000) |
| `--max-bytes <n>` | Refuse when the declared master sizes add up to more (default 10 000 000 000) |
| `--help` | Show the usage text |

Environment for `--live`, read at run time and never printed (names and meaning: `.env.example` class 5, and [MIGRATION.md](MIGRATION.md) for how to set them): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `PUBLIC_IMG_BASE_URL`, and `MIGRATE_ADMIN_EMAIL` with `MIGRATE_ADMIN_PASSWORD` (or `MIGRATE_ACCESS_TOKEN`). The tool signs in as an admin with those; for the API side see [DEPLOY-API.md](DEPLOY-API.md).

Rules for `--out`:

- It must be an absolute path outside the repository, or a folder under the repository's `backup-out/` (gitignored). Anything else inside the repo is refused, and so is a folder that contains the repo.
- The check is lexical: it compares path text and does not follow links, so a deliberate symlink into the repo is not caught. Do not create one.
- A non-empty folder with files the tool did not create is refused unless `--update`.

Check the target before `--live`. The tool is read-only, so there is no `--confirm-project` flag, and the summary does not print a project label: a wrong `SUPABASE_URL` simply backs up the wrong project. Read the URL in your environment against the Supabase dashboard first. (Possible follow-up: print the project label in the summary.)

Output layout:

```
<out>/catalog.json        same shape as the Worker's full-*.json
<out>/manifest.json       per master: id, bytes, sha256, source path, time (no credentials)
<out>/masters/<id>.jpg    one file per photo, original id
```

A rerun fetches only what is missing or changed. Exit code is non-zero when any master could not be saved; the rest is still written.

Cadence: about quarterly, and after a big shoot (this is the only second copy of new masters). Keep the folder on an encrypted disk, outside any synced public folder.

## `npm run restore-plan`

Turns a backup document into a SQL file. It never touches a network and never updates or deletes rows: it inserts with `on conflict (id) do nothing` in foreign-key order, so a second run changes nothing.

```
npm run restore-plan -- --from <catalog.json|full-*.json> --out <restore.sql> [--check] [--force]
```

| Flag | Meaning |
|------|---------|
| `--from <file>` | Required. Accepts `catalog.json` from `npm run backup` or a `full-*.json` from the private bucket |
| `--out <file>` | Where to write the SQL; refuses to overwrite an existing file without `--force` |
| `--check` | Validate only: print row counts and "integrity OK", write nothing |
| `--force` | Overwrite an existing `--out` file |
| `--help` | Show the usage text |

The document is validated first (references between tables, `master_key`, slugs, sizes, unknown keys); a broken file writes nothing.

## Recovery situations

### Situation 1: Supabase is paused

The free project was paused for inactivity. Nothing is lost. Unpause it in the Supabase dashboard and wait until it is up. Do not restore. The public site keeps working meanwhile; only the admin is affected. Pause rules and the admin's behaviour are unverified: [VERIFY.md](VERIFY.md) rows 11 and 30.

### Situation 2: Data lost, or a new Supabase project

1. Take `catalog.json` from your last `npm run backup`, or the newest good `full-*.json` from the private bucket. Run `npm run restore-plan -- --from <file> --check`, then the same with `--out restore.sql`.
2. Apply the migrations to the new project with `supabase db push` ([DATA-MODEL.md](DATA-MODEL.md) describes the schema).
3. Create the two users and their `admins` rows ([ADMIN.md](ADMIN.md), "Deploying the admin", step 5). Point the apps at the new project: [DEPLOY-API.md](DEPLOY-API.md).
4. Run `restore.sql` in the Supabase SQL editor as the owner (postgres role). The photo ids are kept, so the R2 keys still match.
5. Publish from the admin so the public site picks up the restored catalog.

The script switches user triggers off during the insert (`alter table ... disable trigger user`) and back on at the end. Whether the Supabase SQL editor allows this is unverified ([VERIFY.md](VERIFY.md) row 37). If it refuses, the header of the SQL file holds a commented fallback (drop and recreate the five triggers listed there: four `*_bump_pending` triggers and `albums_set_updated_at`). Try the file on a scratch project first.

### Situation 3: R2 objects lost

The catalog is fine but the photo files are gone. Masters come from your local backup (`masters/<id>.jpg`). The restore SQL cannot help here, because it does not write R2 and photos can only be created through the admin upload with new ids. Manual path: delete the affected photo rows first (admin, "delete" on the photos), then upload the master files again through the admin; they get new ids. An automated path (re-uploading masters and keeping ids) is out of scope and is on the backlog.

## Privacy

Client photos are personal data. Keep every backup on encrypted storage or a private bucket, share nothing from it, and delete old copies you no longer need. A backup can keep a deleted photo longer than the website does (deleting on the site does not reach your disk or the 20 rolling `full-*.json` files, which hold catalog rows, not image bytes). A takedown request answer must therefore include the backup copy: delete the file from `masters/`, and say that the catalog entry disappears from the rolling bucket files only after 20 further publishes.
