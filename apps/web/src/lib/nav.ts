/** The header items: the About page and the sections of the one-page home that the header links to. */
export type NavAnchor = 'about' | 'portfolio' | 'reference' | 'kontakt';

export interface NavItem {
  readonly label: string;
  /** Link target that works from every page: the About page `/o-mne/` or an anchor on the home page, e.g. `/#portfolio`. */
  readonly href: string;
  readonly anchor: NavAnchor;
  /** The Kontakt item carries a frame. */
  readonly framed?: boolean;
}

export interface NavLabels {
  readonly about: string;
  readonly portfolio: string;
  readonly reference: string;
  readonly contact: string;
}

/**
 * Header items, in order. Reference is left out when the site has no reviews (the section is not built then).
 * The three category links are not in the header any more; categories stay linked from the home Portfolio
 * section, /portfolio/ and the footer.
 */
export function buildNav(labels: NavLabels, hasReviews: boolean): NavItem[] {
  const items: NavItem[] = [
    { label: labels.about, href: '/o-mne/', anchor: 'about' },
    { label: labels.portfolio, href: '/#portfolio', anchor: 'portfolio' },
  ];
  if (hasReviews) items.push({ label: labels.reference, href: '/#reference', anchor: 'reference' });
  items.push({ label: labels.contact, href: '/#kontakt', anchor: 'kontakt', framed: true });
  return items;
}

/** Real pages that are not part of the Portfolio section. Everything else below the root is /portfolio/, a category or an album. */
const NOT_PORTFOLIO = ['/', '/o-mne/', '/cookies/', '/404/'];

/** True on /portfolio/, category pages and album pages. */
export const isPortfolioPage = (current: string): boolean => !NOT_PORTFOLIO.includes(current);

/**
 * Server-rendered `aria-current` for a nav item. "O mně" is marked with `page` on /o-mne/ (its link targets that
 * page itself); Portfolio is marked with `true` (a section marker) on /portfolio/, categories and albums.
 * On the home page nothing is marked here; scrollspy.ts sets `location` on the link of the section in view.
 */
export const navCurrent = (current: string, item: NavItem): 'page' | 'true' | undefined => {
  if (item.anchor === 'about' && current === '/o-mne/') return 'page';
  return item.anchor === 'portfolio' && isPortfolioPage(current) ? 'true' : undefined;
};

/** The wordmark link claims `page` on the home page (the "O mně" item does the same on /o-mne/, see navCurrent). */
export const wordmarkCurrent = (current: string): 'page' | undefined => (current === '/' ? 'page' : undefined);

/** Compare brand and wordmark as one word: lower case, no spaces. */
export const normalizeBrand = (s: string): string => s.toLowerCase().replace(/\s+/g, '');
