/** The header items: the top of the home page, the About page, the Portfolio page and the Kontakt section of the home. */
export type NavAnchor = 'home' | 'about' | 'portfolio' | 'kontakt';

export interface NavItem {
  readonly label: string;
  /** Link target that works from every page: the About page `/o-mne/`, the Portfolio page `/portfolio/` (T-296) or an anchor on the home page, e.g. `/#kontakt`. */
  readonly href: string;
  readonly anchor: NavAnchor;
  /** The Kontakt item carries a frame. */
  readonly framed?: boolean;
}

export interface NavLabels {
  readonly main: string;
  readonly about: string;
  readonly portfolio: string;
  readonly contact: string;
}

/**
 * Header items, in order: Úvod (the top of the home page, same target as the wordmark), O mně, Portfolio,
 * a framed Kontakt. The Reference section stays on the home page but has no header item (T-325).
 * The three category links are not in the header; categories stay linked from the home Portfolio
 * section, /portfolio/ and the footer.
 */
export function buildNav(labels: NavLabels): NavItem[] {
  return [
    { label: labels.main, href: '/', anchor: 'home' },
    { label: labels.about, href: '/o-mne/', anchor: 'about' },
    { label: labels.portfolio, href: '/portfolio/', anchor: 'portfolio' },
    { label: labels.contact, href: '/#kontakt', anchor: 'kontakt', framed: true },
  ];
}

/** Real pages that are not part of the Portfolio section. Everything else below the root is /portfolio/, a category or an album. */
const NOT_PORTFOLIO = ['/', '/o-mne/', '/cookies/', '/404/'];

/** True on /portfolio/, category pages and album pages. */
export const isPortfolioPage = (current: string): boolean => !NOT_PORTFOLIO.includes(current);

/**
 * Server-rendered `aria-current` for a nav item. "O mně" is marked with `page` on /o-mne/ (its link targets that
 * page itself); Portfolio is marked with `true` (a section marker) on /portfolio/, categories and albums.
 * On the home page Úvod starts as `page` (the hero is in view on load); scrollspy.ts moves the marker:
 * `page` on Úvod while the hero is in view or at the top, `location` on the link of the section in view
 * (only for items that link to a home anchor, so Portfolio, which links to /portfolio/, is never marked on the home).
 */
export const navCurrent = (current: string, item: NavItem): 'page' | 'true' | undefined => {
  if (item.anchor === 'home' && current === '/') return 'page';
  if (item.anchor === 'about' && current === '/o-mne/') return 'page';
  return item.anchor === 'portfolio' && isPortfolioPage(current) ? 'true' : undefined;
};

/** The wordmark link claims `page` on the home page (the "O mně" item does the same on /o-mne/, see navCurrent). */
export const wordmarkCurrent = (current: string): 'page' | undefined => (current === '/' ? 'page' : undefined);

/** Compare brand and wordmark as one word: lower case, no spaces. */
export const normalizeBrand = (s: string): string => s.toLowerCase().replace(/\s+/g, '');
