/**
 * Full catalog backup document (the Worker's `full-<timestamp>.json`, see apps/api publish-service.ts
 * `BackupDocument`) and its integrity rules. Column names follow docs/DATA-MODEL.md (snake_case rows,
 * camelCase `urlHistory` key, exactly as the Worker writes them). Every object is strict.
 *
 * Error messages name the field path and the broken rule, never the offending value.
 */
import { z } from 'zod';
import { isValidPhotoId, masterKey } from './keys';
import { PhotoVariantsSchema, sumBytes } from './variants';

const text = z.string();
const nullableText = z.string().nullable();
/** Timestamps and dates are stored as the database returned them; only non-empty is required. */
const stamp = z.string().min(1);
const sort = z.number().int();
const id = z.string().min(1);

export const BackupCategorySchema = z
  .object({
    id,
    slug: z.string().min(1),
    name: z.string().min(1),
    description: nullableText,
    seo_title: nullableText,
    seo_description: nullableText,
    sort,
    visible: z.boolean(),
    created_at: stamp,
    updated_at: stamp,
  })
  .strict();

export const BackupAlbumSchema = z
  .object({
    id,
    category_id: id,
    slug: z.string().min(1),
    title: text,
    place: nullableText,
    shot_on: nullableText,
    description: nullableText,
    seo_title: nullableText,
    seo_description: nullableText,
    cover_photo_id: id.nullable(),
    sort,
    published: z.boolean(),
    legacy_id: nullableText,
    created_at: stamp,
    updated_at: stamp,
  })
  .strict();

export const BackupPhotoSchema = z
  .object({
    id,
    album_id: id,
    master_key: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    variants: PhotoVariantsSchema,
    bytes_total: z.number().int().nonnegative(),
    dominant_color: nullableText,
    alt: nullableText,
    caption: nullableText,
    sort,
    legacy_key: nullableText,
    created_at: stamp,
    updated_at: stamp,
  })
  .strict();

export const BackupUrlHistorySchema = z
  .object({
    id,
    old_path: z.string().min(1),
    target: nullableText,
    status: z.union([z.literal(301), z.literal(410)]),
    created_at: stamp,
  })
  .strict();

type Path = (string | number)[];

export const BackupDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.iso.datetime({ offset: true }),
    categories: z.array(BackupCategorySchema),
    albums: z.array(BackupAlbumSchema),
    photos: z.array(BackupPhotoSchema),
    urlHistory: z.array(BackupUrlHistorySchema),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const issue = (message: string, path: Path) => ctx.addIssue({ code: 'custom', message, path });

    const unique = (rows: { id: string }[], table: string) => {
      const seen = new Set<string>();
      rows.forEach((r, i) => {
        if (seen.has(r.id)) issue('duplicate id', [table, i, 'id']);
        seen.add(r.id);
      });
    };
    unique(doc.categories, 'categories');
    unique(doc.albums, 'albums');
    unique(doc.photos, 'photos');
    unique(doc.urlHistory, 'urlHistory');

    // Slugs: categories.slug unique per table, albums.slug unique site-wide (DATA-MODEL).
    const slugs = (rows: { slug: string }[], table: string) => {
      const seen = new Set<string>();
      rows.forEach((r, i) => {
        if (seen.has(r.slug)) issue('duplicate slug', [table, i, 'slug']);
        seen.add(r.slug);
      });
    };
    slugs(doc.categories, 'categories');
    slugs(doc.albums, 'albums');

    const categoryIds = new Set(doc.categories.map((c) => c.id));
    const albumIds = new Set(doc.albums.map((a) => a.id));
    const photoIds = new Set(doc.photos.map((p) => p.id));

    doc.albums.forEach((a, i) => {
      if (!categoryIds.has(a.category_id)) issue('category_id does not reference an existing category', ['albums', i, 'category_id']);
      if (a.cover_photo_id !== null && !photoIds.has(a.cover_photo_id)) {
        issue('cover_photo_id does not reference an existing photo', ['albums', i, 'cover_photo_id']);
      }
    });

    doc.photos.forEach((p, i) => {
      if (!albumIds.has(p.album_id)) issue('album_id does not reference an existing album', ['photos', i, 'album_id']);
      if (!isValidPhotoId(p.id)) issue('id is not a valid photo id', ['photos', i, 'id']);
      else if (p.master_key !== masterKey(p.id)) issue('master_key must equal photos/<id>/master.jpg', ['photos', i, 'master_key']);
      if (p.bytes_total !== sumBytes(p.variants)) issue('bytes_total must equal the sum of the variant bytes', ['photos', i, 'bytes_total']);
    });
  });

export type BackupDocument = z.infer<typeof BackupDocumentSchema>;

export interface BackupIssue {
  /** Dotted field path, e.g. `albums.3.category_id`. */
  path: string;
  /** Fixed text naming the broken rule; never contains input values. */
  message: string;
}

export type BackupVerdict = { ok: true; doc: BackupDocument } | { ok: false; issues: BackupIssue[] };

const CODE_MESSAGES: Record<string, string> = {
  unrecognized_keys: 'unknown key',
  invalid_type: 'wrong type or missing field',
  invalid_value: 'value not allowed',
  invalid_format: 'wrong format',
  invalid_union: 'value not allowed',
  too_small: 'value too small or empty',
  too_big: 'value too large',
};

/**
 * Validates shape (strict) and integrity. Messages are rebuilt from fixed text so that no input
 * value can leak into logs; custom rules (our own fixed strings) are passed through.
 */
export function verifyBackupDocument(doc: unknown): BackupVerdict {
  const res = BackupDocumentSchema.safeParse(doc);
  if (res.success) return { ok: true, doc: res.data };
  const issues = res.error.issues.map((i): BackupIssue => {
    const path = i.path.map(String).join('.') || '(root)';
    const message = i.code === 'custom' ? i.message : (CODE_MESSAGES[i.code] ?? 'invalid');
    return { path, message };
  });
  return { ok: false, issues };
}
