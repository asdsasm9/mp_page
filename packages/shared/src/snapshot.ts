/**
 * Public catalog snapshot (catalog/published.json). Arrays are already in display order.
 * No free-form fields, no admin data, no emails. Drafts never appear.
 */
import { z } from 'zod';
import type { AlbumRow, CategoryRow, PhotoRow, SiteSettingsRow, UrlHistoryRow } from './db';
import { PhotoVariantsSchema } from './variants';

const nullableText = z.string().nullable();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const isoDateTime = z.iso.datetime({ offset: true });

export const SnapshotPhotoSchema = z
  .object({
    id: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    alt: nullableText,
    caption: nullableText,
    dominantColor: z.string().regex(/^#[0-9a-f]{6}$/).nullable(),
    variants: PhotoVariantsSchema,
  })
  .strict();

export const SnapshotAlbumSchema = z
  .object({
    slug: z.string().min(1),
    title: z.string().min(1, 'album title is required'),
    place: nullableText,
    shotOn: isoDate.nullable(),
    description: nullableText,
    seoTitle: nullableText,
    seoDescription: nullableText,
    coverPhotoId: z.string().nullable(),
    legacyId: nullableText,
    /** Latest change of the album or any of its photos (sitemap lastmod). */
    updatedAt: isoDateTime,
    photos: z.array(SnapshotPhotoSchema),
  })
  .strict();

export const SnapshotCategorySchema = z
  .object({
    slug: z.string().min(1),
    name: z.string().min(1),
    description: nullableText,
    seoTitle: nullableText,
    seoDescription: nullableText,
    /** Main photo chosen for the category (a photo of one of its albums), null = automatic. Older snapshots lack it. */
    coverPhotoId: z.string().nullable().default(null),
    /** Latest change of the category or any of its published albums (sitemap lastmod). */
    updatedAt: isoDateTime,
    albums: z.array(SnapshotAlbumSchema),
  })
  .strict();

export const SnapshotRedirectSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().nullable(),
    status: z.union([z.literal(301), z.literal(410)]),
  })
  .strict()
  .refine((r) => r.status === 410 || r.to !== null, { message: 'a 301 redirect needs a target', path: ['to'] });

export const SnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.iso.datetime({ offset: true }),
    counts: z
      .object({
        categories: z.number().int().nonnegative(),
        albums: z.number().int().nonnegative(),
        photos: z.number().int().nonnegative(),
      })
      .strict(),
    /** Photo chosen for the home hero (any photo of the snapshot), null = automatic. Older snapshots lack it. */
    heroPhotoId: z.string().nullable().default(null),
    categories: z.array(SnapshotCategorySchema),
    redirects: z.array(SnapshotRedirectSchema),
  })
  .strict()
  .superRefine((s, ctx) => {
    const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path });

    const catSlugs = new Set<string>();
    const albumSlugs = new Set<string>();
    const photoIds = new Set<string>();
    let albums = 0;
    let photos = 0;

    s.categories.forEach((c, ci) => {
      if (catSlugs.has(c.slug)) issue(`duplicate category slug "${c.slug}"`, ['categories', ci, 'slug']);
      catSlugs.add(c.slug);
      if (c.coverPhotoId !== null && !c.albums.some((a) => a.photos.some((x) => x.id === c.coverPhotoId))) {
        issue(`coverPhotoId "${c.coverPhotoId}" is not a photo of category "${c.slug}"`, ['categories', ci, 'coverPhotoId']);
      }
      c.albums.forEach((a, ai) => {
        albums++;
        const p = ['categories', ci, 'albums', ai];
        if (albumSlugs.has(a.slug)) issue(`duplicate album slug "${a.slug}" (album slugs are unique site-wide)`, [...p, 'slug']);
        albumSlugs.add(a.slug);
        const ids = new Set(a.photos.map((x) => x.id));
        if (a.coverPhotoId === null) {
          if (a.photos.length > 0) issue('coverPhotoId may only be null when the album has no photos', [...p, 'coverPhotoId']);
        } else if (!ids.has(a.coverPhotoId)) {
          issue(`coverPhotoId "${a.coverPhotoId}" is not a photo of album "${a.slug}"`, [...p, 'coverPhotoId']);
        }
        a.photos.forEach((ph, pi) => {
          photos++;
          if (photoIds.has(ph.id)) issue(`duplicate photo id "${ph.id}"`, [...p, 'photos', pi, 'id']);
          photoIds.add(ph.id);
        });
      });
    });

    if (s.heroPhotoId !== null && !photoIds.has(s.heroPhotoId)) {
      issue(`heroPhotoId "${s.heroPhotoId}" is not a photo of the snapshot`, ['heroPhotoId']);
    }

    const actual = { categories: s.categories.length, albums, photos };
    for (const k of ['categories', 'albums', 'photos'] as const) {
      if (s.counts[k] !== actual[k]) issue(`counts.${k} is ${s.counts[k]} but the snapshot has ${actual[k]}`, ['counts', k]);
    }
  });

export type Snapshot = z.infer<typeof SnapshotSchema>;
export type SnapshotCategory = z.infer<typeof SnapshotCategorySchema>;
export type SnapshotAlbum = z.infer<typeof SnapshotAlbumSchema>;
export type SnapshotPhoto = z.infer<typeof SnapshotPhotoSchema>;

export class SnapshotEmptyError extends Error {
  readonly code = 'SNAPSHOT_EMPTY' as const;
  constructor() {
    super('SNAPSHOT_EMPTY');
    this.name = 'SnapshotEmptyError';
  }
}

/** Refuses to publish a snapshot without any album. Called by the Worker and the Astro build. */
export function assertPublishable(snapshot: Snapshot): void {
  if (snapshot.counts.albums === 0 || snapshot.categories.every((c) => c.albums.length === 0)) {
    throw new SnapshotEmptyError();
  }
}

// ------------------------------------------------------------------ builder

export interface SnapshotSource {
  categories: CategoryRow[];
  albums: AlbumRow[];
  photos: PhotoRow[];
  urlHistory: UrlHistoryRow[];
  /** The single site_settings row; absent or null means no hero chosen (older callers omit it). */
  siteSettings?: SiteSettingsRow | null;
}

type Sortable = { sort: number; id: string };

/** Latest of the given timestamps as a UTC ISO string (database offsets are normalised). */
function latest(...stamps: string[]): string {
  return new Date(Math.max(...stamps.map((s) => Date.parse(s)))).toISOString();
}
const bySortThenId = (a: Sortable, b: Sortable) => a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Builds the public snapshot from database rows: hidden categories and unpublished albums are
 * dropped (so is any album in a hidden category), order is sort then id, the cover falls back to
 * the lowest-sort photo, and the result is validated against SnapshotSchema.
 */
export function buildSnapshot(src: SnapshotSource, now: Date): Snapshot {
  const photosByAlbum = new Map<string, PhotoRow[]>();
  for (const p of src.photos) {
    const list = photosByAlbum.get(p.album_id);
    if (list) list.push(p);
    else photosByAlbum.set(p.album_id, [p]);
  }
  const albumsByCategory = new Map<string, AlbumRow[]>();
  for (const a of src.albums) {
    if (!a.published) continue;
    const list = albumsByCategory.get(a.category_id);
    if (list) list.push(a);
    else albumsByCategory.set(a.category_id, [a]);
  }

  let albumCount = 0;
  let photoCount = 0;

  const categories: SnapshotCategory[] = [...src.categories]
    .filter((c) => c.visible)
    .sort(bySortThenId)
    .map((c) => {
      const albums = [...(albumsByCategory.get(c.id) ?? [])].sort(bySortThenId).map((a) => {
        const photos = [...(photosByAlbum.get(a.id) ?? [])].sort(bySortThenId);
        const cover =
          a.cover_photo_id !== null && photos.some((p) => p.id === a.cover_photo_id)
            ? a.cover_photo_id
            : (photos[0]?.id ?? null);
        albumCount++;
        photoCount += photos.length;
        return {
          slug: a.slug,
          title: a.title,
          place: a.place,
          shotOn: a.shot_on === null ? null : a.shot_on.slice(0, 10),
          description: a.description,
          seoTitle: a.seo_title,
          seoDescription: a.seo_description,
          coverPhotoId: cover,
          legacyId: a.legacy_id,
          updatedAt: latest(a.updated_at, ...photos.map((p) => p.updated_at)),
          photos: photos.map((p) => ({
            id: p.id,
            width: p.width,
            height: p.height,
            alt: p.alt,
            caption: p.caption,
            dominantColor: p.dominant_color,
            variants: p.variants,
          })),
        };
      });
      // Only a photo of a published album of this visible category is exposed; a stale value becomes null.
      const coverPhotoId =
        c.cover_photo_id != null && albums.some((a) => a.photos.some((p) => p.id === c.cover_photo_id))
          ? c.cover_photo_id
          : null;
      return {
        slug: c.slug,
        name: c.name,
        description: c.description,
        seoTitle: c.seo_title,
        seoDescription: c.seo_description,
        coverPhotoId,
        updatedAt: latest(c.updated_at, ...albums.map((a) => a.updatedAt)),
        albums,
      };
    });

  const redirects = [...src.urlHistory]
    .sort((a, b) => (a.old_path < b.old_path ? -1 : a.old_path > b.old_path ? 1 : 0))
    .map((r) => ({ from: r.old_path, to: r.target, status: r.status }));

  // Only a photo of a published album of a visible category is exposed; a stale value becomes null.
  const chosenHero = src.siteSettings?.hero_photo_id ?? null;
  const heroPhotoId =
    chosenHero !== null && categories.some((c) => c.albums.some((a) => a.photos.some((p) => p.id === chosenHero)))
      ? chosenHero
      : null;

  return SnapshotSchema.parse({
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    counts: { categories: categories.length, albums: albumCount, photos: photoCount },
    heroPhotoId,
    categories,
    redirects,
  });
}
