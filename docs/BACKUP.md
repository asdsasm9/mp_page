# Backups: there are none

The owner decided (2026-10-22, T-222 and D-17) that no backup is wanted: not of the photos and not of the catalog. There is no backup bucket, no backup tool, no restore tool and no backup file. The public bucket holds only the photos and `catalog/published.json`. Nothing described here was run against a live service.

## What is and is not recoverable

| Data | Recoverable? | How |
|------|--------------|-----|
| Photo files (masters and variants) | No. Once `legacy/` is removed they exist only in R2 and on the photographer's own devices | A deleted photo or a lost bucket cannot be recovered from this project. Upload the originals again from her devices; they get new ids |
| Published catalog (published albums with their photos, titles, order, alt texts) | Partly | `catalog/published.json` in the photo bucket is the last published state ([API.md](API.md#post-publish)). A fresh Supabase project has to be filled by hand or with a one-off script written for the occasion: the file has no album or category ids and no master keys, so there is no ready tool and nothing here promises an exact restore. The built public site also still shows it |
| Drafts, unpublished and hidden albums or categories, `url_history` | No | They are not in the snapshot. Git history of this repo holds code only, not data |
| Users, `admin_emails` rows, the Google provider and OAuth client, Supabase auth | No | Recreated by hand, [ADMIN.md](ADMIN.md) step 5 ("Deploying the admin") |

## Situations

### Situation 1: Supabase is paused

The free project was paused for inactivity. Nothing is lost. Unpause it in the Supabase dashboard and wait until it is up. The public site keeps working meanwhile; only the admin is affected. Pause rules and the admin's behaviour are unverified: [VERIFY.md](VERIFY.md) rows 11 and 30.

### Situation 2: Supabase data lost, or a new project

Apply the migrations with `supabase db push` ([DATA-MODEL.md](DATA-MODEL.md)), enable the Google provider and add the two `admin_emails` rows ([ADMIN.md](ADMIN.md) step 5) and point the apps at the new project ([DEPLOY-API.md](DEPLOY-API.md)). The catalog then has to be re-entered from `catalog/published.json` as described above; the photos already in R2 keep their ids and keys only if their rows are recreated with the same ids, which no tool does. Drafts are gone.

### Situation 3: R2 objects lost

The photo files are gone and cannot be recovered from this project. The only source is the originals on the photographer's own devices.

## Privacy

Client photos are personal data. The only copy is in the photo bucket, so deleting a photo in the admin removes the image for good. Because nothing else holds a copy, a takedown request needs no further step on our side; copies on her own devices or sent to others are hers to delete.
