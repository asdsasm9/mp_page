/**
 * Current-section marker on the home page (progressive enhancement). Without this script no nav link is
 * marked. An IntersectionObserver watches a band just below the header; the section in that band gets
 * `aria-current="location"` on its header links (desktop nav and drawer copy). The hero (`uvod`) is watched
 * too: while it is in view (or at the very top) Hlavní carries `aria-current="page"` and no other link is
 * marked. The Reference section has no header item (T-325). Only the fixed list of ids below is ever read.
 * `o-mne` is the short hello section of the home: it stays in the list so the marker clears there, but the
 * "O mně" nav item links to the /o-mne/ page (data-nav-anchor="about") and is never marked here; the same holds
 * for Portfolio, which links to /portfolio/. Both stay out of `links`, so their sections only clear the marker.
 */
import { applyEntries, homeMarker, pickCurrent } from './scrollspy-state';

const ORDER = ['uvod', 'o-mne', 'portfolio', 'reference', 'kontakt'] as const;

export function startScrollspy(root: Document = document): void {
  if (!('IntersectionObserver' in window)) return;
  const sections = ORDER.map((id) => root.getElementById(id)).filter((el): el is HTMLElement => el !== null);
  if (sections.length === 0) return;
  // Only items that link to the top of the home (`/`, Hlavní) or to a home anchor (`/#...`); Portfolio links to
  // /portfolio/ (T-296) and is never marked here.
  const links = [...root.querySelectorAll<HTMLAnchorElement>('[data-nav-anchor][href="/"], [data-nav-anchor][href^="/#"]')];

  let visible = new Set<string>();
  const mark = (): void => {
    const id = pickCurrent(ORDER, visible);
    const atTop = window.scrollY < 1;
    for (const link of links) {
      const value = homeMarker(link.dataset.navAnchor ?? '', id, atTop);
      if (value) link.setAttribute('aria-current', value);
      else link.removeAttribute('aria-current');
    }
  };

  // The wordmark and Hlavní both go to the very top and drop any #hash (also when already on `/`).
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href="/"]')) {
    a.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      window.scrollTo({ top: 0 });
    });
  }

  // The band starts under the sticky header and ends 55 % up from the bottom: a section counts once its top
  // has passed the upper half of the screen.
  const header = root.querySelector('.site-header');
  const offset = header ? Math.round(header.getBoundingClientRect().height) : 0;
  const observer = new IntersectionObserver(
    (entries) => {
      visible = applyEntries(
        visible,
        entries.map((e) => ({ id: e.target.id, isIntersecting: e.isIntersecting })),
      );
      mark();
    },
    { rootMargin: `-${offset}px 0px -55% 0px` },
  );
  for (const section of sections) observer.observe(section);
}

if (location.pathname === '/') startScrollspy();
