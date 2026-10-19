/** Slug rules. The regexes equal the DB check constraints (WP-2 section 3.1). */

/** Same list as the check constraint on categories.slug (a parity test compares them). */
export const RESERVED_CATEGORY_SLUGS = [
  'portfolio',
  'o-mne',
  'kontakt',
  '404',
  'admin',
  'api',
  'img',
  'assets',
  '_astro',
  'fotky_web',
  'sitemap',
  'robots',
  'cookies',
  'ochrana-udaju',
] as const;

export const SLUG_MIN = 2;
export const SLUG_MAX = 60;

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const LEGACY_SLUG_RE = /^[a-z0-9]+([-_][a-z0-9]+)*$/;

export function isValidSlug(s: string, opts: { legacy?: boolean } = {}): boolean {
  if (typeof s !== 'string' || s.length < SLUG_MIN || s.length > SLUG_MAX) return false;
  return (opts.legacy ? LEGACY_SLUG_RE : SLUG_RE).test(s);
}

export function isReservedCategorySlug(s: string): boolean {
  return (RESERVED_CATEGORY_SLUGS as readonly string[]).includes(s);
}

export function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, SLUG_MAX).replace(/-+$/g, '');
}

/** Returns base, base-2, base-3 ... the first not in `taken`. The base is shortened so the result stays within 60 characters. */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const set = taken instanceof Set ? (taken as Set<string>) : new Set(taken);
  if (!set.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/g, '') + suffix;
    if (!set.has(candidate)) return candidate;
  }
}
