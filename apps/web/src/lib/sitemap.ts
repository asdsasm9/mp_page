/**
 * Sitemap and robots.txt builders (docs/SEO.md section 6). Pure: take the catalog categories and return text.
 *
 * URL set: `/`, `/portfolio/`, every category, every album with photos (the same filter as the album route),
 * `/cookies/`. With the fixture that is 1 home + 1 portfolio + 3 categories + 13 albums + 1 fixed = 19 URLs
 * (T-288: /o-mne/ and /kontakt/ are home sections, redirected, not listed).
 * 404 and noindex pages are never listed. Fixed pages carry no `lastmod`; categories and albums use `updatedAt`.
 */
import { effectiveAlt, jpegKey, type SnapshotAlbum, type SnapshotCategory } from '@mp/shared';
import { SITE_ORIGIN, albumPath, pageUrl } from './jsonld';

/** Google accepts at most 1000 images per <url>; longer albums are capped (the page itself still shows all). */
export const MAX_IMAGES_PER_URL = 1000;

/** Fixed pages in listing order; the home page comes first, the rest after the categories and albums. */
export const FIXED_PATHS_BEFORE = ['/', '/portfolio/'] as const;
export const FIXED_PATHS_AFTER = ['/cookies/'] as const;

export function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** W3C date (YYYY-MM-DD) from an ISO date-time. */
export const lastmodOf = (iso: string): string => iso.slice(0, 10);

const absolute = (url: string): string => (url.startsWith('/') ? `${SITE_ORIGIN}${url}` : url);

function urlEntry(loc: string, lastmod?: string, images: string[] = []): string {
  const lines = ['  <url>', `    <loc>${xmlEscape(loc)}</loc>`];
  if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);
  lines.push(...images);
  lines.push('  </url>');
  return lines.join('\n');
}

function albumImages(category: SnapshotCategory, album: SnapshotAlbum, imgBase: string): string[] {
  const base = imgBase.replace(/\/+$/, '');
  const total = album.photos.length;
  return album.photos.slice(0, MAX_IMAGES_PER_URL).map((photo, i) => {
    const caption = effectiveAlt(photo, { albumTitle: album.title, categoryKey: category.slug, n: i + 1, total });
    return [
      '    <image:image>',
      `      <image:loc>${xmlEscape(absolute(`${base}/${jpegKey(photo.id)}`))}</image:loc>`,
      `      <image:caption>${xmlEscape(caption)}</image:caption>`,
      '    </image:image>',
    ].join('\n');
  });
}

/** Absolute paths of every page in the sitemap, in listing order. */
export function sitemapPaths(categories: readonly SnapshotCategory[]): string[] {
  const paths: string[] = [FIXED_PATHS_BEFORE[0]];
  paths.push(FIXED_PATHS_BEFORE[1]);
  for (const c of categories) paths.push(`/${c.slug}/`);
  for (const c of categories) {
    for (const a of c.albums) if (a.photos.length > 0) paths.push(albumPath(c, a));
  }
  paths.push(...FIXED_PATHS_AFTER);
  return paths;
}

export function buildSitemap(categories: readonly SnapshotCategory[], imgBase: string): string {
  const entries: string[] = [];
  for (const p of FIXED_PATHS_BEFORE) entries.push(urlEntry(pageUrl(p)));
  for (const c of categories) entries.push(urlEntry(pageUrl(`/${c.slug}/`), lastmodOf(c.updatedAt)));
  for (const c of categories) {
    for (const a of c.albums) {
      if (a.photos.length === 0) continue;
      entries.push(urlEntry(pageUrl(albumPath(c, a)), lastmodOf(a.updatedAt), albumImages(c, a, imgBase)));
    }
  }
  for (const p of FIXED_PATHS_AFTER) entries.push(urlEntry(pageUrl(p)));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n');
}

/**
 * AI crawlers and assistants named explicitly in production robots.txt (docs/SEO-AI.md). `Google-Extended` is a
 * control token, not a separate crawler. Allowing them is a stance the photographer can revert by deleting names here.
 */
export const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'PerplexityBot',
  'Google-Extended',
] as const;

/** Production allows all (AI crawlers by name) and names the sitemap; every other environment disallows everything. */
export function buildRobots(production: boolean): string {
  if (!production) return 'User-agent: *\nDisallow: /\n';
  const groups = ['*', ...AI_CRAWLERS].map((agent) => `User-agent: ${agent}\nAllow: /\n`);
  return `${groups.join('\n')}\nSitemap: ${pageUrl('/sitemap.xml')}\n`;
}
