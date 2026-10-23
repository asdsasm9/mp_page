/** The sections of the one-page home that the header links to. */
export type NavAnchor = 'o-mne' | 'portfolio' | 'reference' | 'kontakt';

export interface NavItem {
  readonly label: string;
  /** Link target, always an anchor on the home page so it works from every page, e.g. `/#portfolio`. */
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
    { label: labels.about, href: '/#o-mne', anchor: 'o-mne' },
    { label: labels.portfolio, href: '/#portfolio', anchor: 'portfolio' },
  ];
  if (hasReviews) items.push({ label: labels.reference, href: '/#reference', anchor: 'reference' });
  items.push({ label: labels.contact, href: '/#kontakt', anchor: 'kontakt', framed: true });
  return items;
}

/** Real pages that are not part of the Portfolio section. Everything else below the root is /portfolio/, a category or an album. */
const NOT_PORTFOLIO = ['/', '/cookies/', '/404/'];

/** True on /portfolio/, category pages and album pages. */
export const isPortfolioPage = (current: string): boolean => !NOT_PORTFOLIO.includes(current);

/**
 * Server-rendered `aria-current` for a nav item. Only Portfolio is ever marked, with `true` (a section marker):
 * `page` is never used because no nav link targets the page itself. On the home page nothing is marked
 * here; scrollspy.ts sets `location` on the link of the section in view.
 */
export const navCurrent = (current: string, item: NavItem): 'true' | undefined =>
  item.anchor === 'portfolio' && isPortfolioPage(current) ? 'true' : undefined;

/** The wordmark link is the only link that can claim `page`, and only on the home page. */
export const wordmarkCurrent = (current: string): 'page' | undefined => (current === '/' ? 'page' : undefined);

/** Compare brand and wordmark as one word: lower case, no spaces. */
export const normalizeBrand = (s: string): string => s.toLowerCase().replace(/\s+/g, '');
