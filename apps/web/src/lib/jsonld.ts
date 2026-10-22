/**
 * JSON-LD builders (docs/SEO.md section 5, plan WP-3 section 4.6). Pure functions returning plain objects,
 * plus `serializeJsonLd`, the only way to put them into a `<script type="application/ld+json">`.
 * Unanswered optional properties (telephone, priceRange, street address, opening hours, geo) are never emitted,
 * and no Review or AggregateRating is ever produced (SEO.md 5.1).
 */
import { effectiveAlt, jpegKey, webpKey, type SnapshotAlbum, type SnapshotCategory, type SnapshotPhoto, type WebpTier } from '@mp/shared';
import { BRAND } from './seo';
import { INSTAGRAM_HANDLE, MAIL_ADDRESS, MYWED_URL } from '../content/texts';

export const SITE_ORIGIN = 'https://www.mullnyphotos.cz';
/** Photos per ImageGallery (SEO.md 5.3). */
export const GALLERY_MAX = 20;

export type JsonLd = Record<string, unknown>;

const CONTEXT = 'https://schema.org';
export const BUSINESS_ID = `${SITE_ORIGIN}/#business`;
export const PERSON_ID = `${SITE_ORIGIN}/#terezie`;
const INSTAGRAM_PROFILE = `https://www.instagram.com/${INSTAGRAM_HANDLE.replace(/^@/, '')}/`;

/** Factual one-liner shared by the Photographer JSON-LD and llms.txt (services as listed on the site; no prices). */
export const BUSINESS_DESCRIPTION =
  'Fotografka Terezie Müllnerová z Brna: svatební, portrétní a párové focení v Brně a Jihomoravském kraji.';

/** Absolute page URL on the production origin; `path` like `/svatby/` (leading and trailing slash). */
export const pageUrl = (path: string): string => `${SITE_ORIGIN}${path}`;

const trimBase = (base: string): string => base.replace(/\/+$/, '');

// ------------------------------------------------------------------ serializer

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

/** Stringifies and escapes `<`, `>`, `&`, U+2028 and U+2029 so the text is inert inside a script element. */
export function serializeJsonLd(data: JsonLd | readonly JsonLd[]): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replaceAll(LS, '\\u2028')
    .replaceAll(PS, '\\u2029');
}

// ------------------------------------------------------------------ business, website, person

/** Short reference used on pages other than Home and Contact. */
export const photographerRef = (): JsonLd => ({ '@id': BUSINESS_ID });

/** SEO.md 5.1, full entity (Home, Contact). `imageUrl` is the absolute home OG image URL. */
export function photographerFull(imageUrl: string): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'Photographer',
    '@id': BUSINESS_ID,
    name: BRAND,
    url: `${SITE_ORIGIN}/`,
    description: BUSINESS_DESCRIPTION,
    image: imageUrl,
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Brno',
      addressRegion: 'Jihomoravský kraj',
      addressCountry: 'CZ',
    },
    areaServed: [
      { '@type': 'City', name: 'Brno' },
      { '@type': 'AdministrativeArea', name: 'Jihomoravský kraj' },
    ],
    email: MAIL_ADDRESS,
    sameAs: [INSTAGRAM_PROFILE, MYWED_URL],
  };
}

/** SEO.md 5.5, Home only. */
export const website = (): JsonLd => ({
  '@context': CONTEXT,
  '@type': 'WebSite',
  name: BRAND,
  url: `${SITE_ORIGIN}/`,
  inLanguage: 'cs',
});

/** SEO.md 5.2, About only. `imageUrl` is the absolute about photo URL. */
export function person(imageUrl: string): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'Person',
    '@id': PERSON_ID,
    name: 'Terezie Müllnerová',
    jobTitle: 'Fotografka',
    worksFor: { '@id': BUSINESS_ID },
    url: pageUrl('/o-mne/'),
    image: imageUrl,
  };
}

// ------------------------------------------------------------------ breadcrumbs

export interface Crumb {
  readonly name: string;
  /** Path like `/svatby/`. */
  readonly path: string;
}

/** SEO.md 5.4. The root crumb `Úvod` is added here; pass the crumbs after it. */
export function breadcrumbList(crumbs: readonly Crumb[]): JsonLd {
  const all: Crumb[] = [{ name: 'Úvod', path: '/' }, ...crumbs];
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: all.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: pageUrl(c.path),
    })),
  };
}

// ------------------------------------------------------------------ galleries

const categoryPath = (category: Pick<SnapshotCategory, 'slug'>): string => `/${category.slug}/`;
export const albumPath = (category: Pick<SnapshotCategory, 'slug'>, album: Pick<SnapshotAlbum, 'slug'>): string =>
  `/${category.slug}/${album.slug}/`;

function imageObject(photo: SnapshotPhoto, imgBase: string, name: string): JsonLd {
  const base = trimBase(imgBase);
  const thumb = photo.variants.webp.find((v) => v.tier === 480) ?? photo.variants.webp[0]!;
  const out: JsonLd = {
    '@type': 'ImageObject',
    contentUrl: `${base}/${jpegKey(photo.id)}`,
    thumbnailUrl: `${base}/${webpKey(photo.id, thumb.tier as WebpTier)}`,
    width: photo.variants.jpeg.w,
    height: photo.variants.jpeg.h,
    name,
    creator: photographerRef(),
    copyrightHolder: { '@type': 'Organization', name: BRAND },
  };
  const caption = photo.caption?.trim();
  if (caption) out.caption = caption;
  return out;
}

/** Cover first, then the rest in sort order, at most GALLERY_MAX. */
export function galleryPhotos(album: SnapshotAlbum): Array<{ photo: SnapshotPhoto; n: number }> {
  const numbered = album.photos.map((photo, i) => ({ photo, n: i + 1 }));
  const cover = numbered.find((x) => x.photo.id === album.coverPhotoId);
  const rest = numbered.filter((x) => x !== cover);
  return (cover ? [cover, ...rest] : rest).slice(0, GALLERY_MAX);
}

/** SEO.md 5.3 on an album page. `description` is the page's meta description. */
export function albumGallery(
  category: SnapshotCategory,
  album: SnapshotAlbum,
  description: string,
  imgBase: string,
): JsonLd {
  const total = album.photos.length;
  const out: JsonLd = {
    '@context': CONTEXT,
    '@type': 'ImageGallery',
    name: album.title,
    url: pageUrl(albumPath(category, album)),
    description,
    inLanguage: 'cs',
    creator: photographerRef(),
    image: galleryPhotos(album).map(({ photo, n }) =>
      imageObject(photo, imgBase, effectiveAlt(photo, { albumTitle: album.title, categoryKey: category.slug, n, total })),
    ),
  };
  if (album.shotOn) out.dateCreated = album.shotOn;
  const place = album.place?.trim();
  if (place) out.contentLocation = { '@type': 'Place', name: place };
  return out;
}

/** SEO.md 5.3 on a category page: one ImageObject per album cover, linking to the album page. */
export function categoryGallery(category: SnapshotCategory, description: string, imgBase: string): JsonLd {
  const items: JsonLd[] = [];
  for (const album of category.albums) {
    const idx = album.photos.findIndex((p) => p.id === album.coverPhotoId);
    const cover = album.photos[idx];
    if (!cover) continue;
    items.push({
      ...imageObject(
        cover,
        imgBase,
        effectiveAlt(cover, { albumTitle: album.title, categoryKey: category.slug, n: idx + 1, total: album.photos.length }),
      ),
      url: pageUrl(albumPath(category, album)),
      name: album.title,
    });
  }
  return {
    '@context': CONTEXT,
    '@type': 'ImageGallery',
    name: category.name,
    url: pageUrl(categoryPath(category)),
    description,
    inLanguage: 'cs',
    creator: photographerRef(),
    image: items,
  };
}
