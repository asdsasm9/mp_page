/**
 * Title and description patterns (docs/SEO.md section 2, plan WP-3 section 4.6). Pure functions; the
 * pattern text is exactly the SEO.md table. Wording tied to an open question (Q-n) uses the placeholder
 * text and never fails the build. Limits: title 65, description 160 (hard), see `checkMetas`.
 */
import type { SnapshotAlbum, SnapshotCategory } from '@mp/shared';
import { plural, type PluralForms } from './plural';

export const BRAND = 'Mullny Photos';
export const TITLE_MAX = 65;
export const DESCRIPTION_MAX = 160;

export interface PageMeta {
  /** Full `<title>`, ends with ` | Mullny Photos`. */
  readonly title: string;
  /** `og:title`: the title without the brand suffix. */
  readonly ogTitle: string;
  /** Null for pages without a description (404). */
  readonly description: string | null;
  /** True for pages that carry `noindex, nofollow` regardless of environment. */
  readonly noindex: boolean;
}

const withBrand = (core: string): string => `${core} | ${BRAND}`;

function meta(core: string, description: string | null, noindex = false): PageMeta {
  return { title: withBrand(core), ogTitle: core, description, noindex };
}

/** Cuts `text` to at most `max` characters at a word boundary and appends an ellipsis. */
export function trimWords(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return '…';
  let cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  if (space > 0) cut = cut.slice(0, space);
  return `${cut.replace(/[\s,;:.–-]+$/u, '')}…`;
}

export const fitDescription = (text: string): string => trimWords(text.trim(), DESCRIPTION_MAX);

/**
 * Album title without the brand: drops ` – {place}` first when the full title is over 65 characters, then
 * trims the album title at a word boundary with an ellipsis.
 */
export function fitAlbumTitle(title: string, place: string | null, categorySingular: string): string {
  const brandLength = ` | ${BRAND}`.length;
  const tail = ` – ${categorySingular}`;
  if (place) {
    const full = `${title} – ${place}${tail}`;
    if (full.length + brandLength <= TITLE_MAX) return full;
  }
  return `${trimWords(title, TITLE_MAX - brandLength - tail.length)}${tail}`;
}

// ------------------------------------------------------------------ fixed pages

export const homeMeta = (): PageMeta =>
  meta(
    'Fotograf Brno: svatby, portréty, páry',
    'Svatební, portrétní a párový fotograf z Brna. Přirozené fotografie plné emocí, focení v Brně a Jihomoravském kraji. Napište mi o termínu.',
  );

export const aboutMeta = (): PageMeta =>
  meta(
    'O mně – fotografka Terezie Müllnerová, Brno',
    'Jsem Terezie Müllnerová, fotografka z Brna. Specializuji se na svatby, portréty a párové focení. Přečtěte si můj příběh a zkušenosti.',
  );

/** Q-6 placeholder wording; the real /portfolio/ page (decision D-6) lists all categories and a selection of albums. */
export const portfolioMeta = (): PageMeta =>
  meta(
    'Portfolio – svatby, portréty a páry v Brně',
    'Portfolio fotografky z Brna: ukázky svateb, portrétů a párového focení. Prohlédněte si všechny kategorie a výběr mých alb.',
  );

/** Title from SEO.md section 6; the description is not specified there, so this wording is ours. */
export const cookiesMeta = (): PageMeta =>
  meta(
    'Zásady cookies a ochrany soukromí',
    'Zásady používání cookies a ochrany osobních údajů na webu Mullny Photos. Zjistěte, jaké údaje web zpracovává a proč.',
  );

export const notFoundMeta = (): PageMeta => meta('Stránka nenalezena', null, true);

// ------------------------------------------------------------------ categories

interface CategoryPattern {
  readonly title: string;
  readonly description: (count: number) => string;
  /** Lower-case singular used in album titles and descriptions. */
  readonly singular: string;
}

/** Wording of the three known categories, keyed by slug. `one` is the accusative ("Prohlédněte si 1 svatbu"). */
const WEDDINGS: PluralForms = { one: 'svatbu', few: 'svatby', many: 'svateb' };

const CATEGORY_PATTERNS: Readonly<Record<string, CategoryPattern>> = {
  svatby: {
    title: 'Svatební fotograf Brno – svatby',
    description: (count) =>
      `Ukázky svatebních fotografií z Brna a okolí. Reportážní focení svatebního dne od příprav po první tanec. Prohlédněte si ${plural(count, WEDDINGS)}.`,
    singular: 'svatba',
  },
  portrety: {
    title: 'Portrétní focení Brno – portréty a rodiny',
    description: () =>
      'Portréty, rodinné a těhotenské focení v Brně, ve studiu nebo u vás doma. Prohlédněte si ukázky mých fotografií.',
    singular: 'portrét',
  },
  'parove-foceni': {
    title: 'Párové focení Brno – fotky pro páry',
    description: () =>
      'Párové a zásnubní focení v Brně a okolí. Uvolněné fotografie, které vás vystihují. Prohlédněte si ukázky.',
    singular: 'párové focení',
  },
};

const ALBUMS: PluralForms = { one: 'album', few: 'alba', many: 'alb' };

/** Singular name of a category for album titles, e.g. `svatba`. Categories added later fall back to their lower-cased name. */
export function categorySingular(category: Pick<SnapshotCategory, 'slug' | 'name'>): string {
  return CATEGORY_PATTERNS[category.slug]?.singular ?? category.name.toLocaleLowerCase('cs');
}

export function categoryMeta(category: SnapshotCategory): PageMeta {
  const count = category.albums.length;
  const pattern = CATEGORY_PATTERNS[category.slug];
  const core = category.seoTitle?.trim() || pattern?.title || `${category.name} – focení Brno`;
  const description =
    category.seoDescription?.trim() ||
    pattern?.description(count) ||
    `Ukázky fotografií v kategorii ${category.name} od fotografky z Brna. Prohlédněte si ${plural(count, ALBUMS)}.`;
  return meta(trimWords(core, TITLE_MAX - ` | ${BRAND}`.length), fitDescription(description));
}

// ------------------------------------------------------------------ albums

const capitalize = (s: string): string => s.charAt(0).toLocaleUpperCase('cs') + s.slice(1);
const PHOTOS: PluralForms = { one: 'fotografie', few: 'fotografie', many: 'fotografií' };

/**
 * Album fallback description: `{Category singular} {title}{ v místě {place}}. {n} fotografií z focení v Brně
 * a okolí od fotografky Mullny Photos.` When too long the place goes first, then the title is trimmed.
 */
export function albumFallbackDescription(album: SnapshotAlbum, singular: string): string {
  const tail = `. ${plural(album.photos.length, PHOTOS)} z focení v Brně a okolí od fotografky ${BRAND}.`;
  const lead = `${capitalize(singular)} `;
  const placePart = album.place ? ` v místě ${album.place}` : '';
  const full = `${lead}${album.title}${placePart}${tail}`;
  if (full.length <= DESCRIPTION_MAX) return full;
  const noPlace = `${lead}${album.title}${tail}`;
  if (noPlace.length <= DESCRIPTION_MAX) return noPlace;
  return `${lead}${trimWords(album.title, DESCRIPTION_MAX - lead.length - tail.length)}${tail}`;
}

export function albumMeta(category: SnapshotCategory, album: SnapshotAlbum): PageMeta {
  const singular = categorySingular(category);
  const seoTitle = album.seoTitle?.trim();
  const core = seoTitle
    ? trimWords(seoTitle, TITLE_MAX - ` | ${BRAND}`.length)
    : fitAlbumTitle(album.title, album.place, singular);
  const seoDescription = album.seoDescription?.trim();
  const description = seoDescription ? fitDescription(seoDescription) : albumFallbackDescription(album, singular);
  return meta(core, description);
}

// ------------------------------------------------------------------ build check

/**
 * Build check (SEO.md section 2): returns the problems for a set of `[url, meta]` pairs. Empty, over-limit
 * or duplicated titles and descriptions are problems; titles outside 50 to 60 are not (warnings elsewhere).
 */
export function checkMetas(entries: ReadonlyArray<readonly [string, PageMeta]>): string[] {
  const problems: string[] = [];
  const titles = new Map<string, string>();
  const descriptions = new Map<string, string>();
  for (const [url, m] of entries) {
    if (!m.title.trim()) problems.push(`${url}: empty title`);
    if (m.title.length > TITLE_MAX) problems.push(`${url}: title over ${TITLE_MAX}`);
    const otherTitle = titles.get(m.title);
    if (otherTitle) problems.push(`${url}: title duplicates ${otherTitle}`);
    titles.set(m.title, url);
    if (m.description === null) {
      if (!m.noindex) problems.push(`${url}: missing description`);
      continue;
    }
    if (!m.description.trim()) problems.push(`${url}: empty description`);
    if (m.description.length > DESCRIPTION_MAX) problems.push(`${url}: description over ${DESCRIPTION_MAX}`);
    const otherDescription = descriptions.get(m.description);
    if (otherDescription) problems.push(`${url}: description duplicates ${otherDescription}`);
    descriptions.set(m.description, url);
  }
  return problems;
}
