/**
 * Current-section marker on the home page (progressive enhancement). Without this script no nav link is
 * marked. An IntersectionObserver watches a band just below the header; the section in that band gets
 * `aria-current="location"` on its header links (desktop nav and drawer copy). The hero (`uvod`) is watched
 * too, so the marker clears while it is in view. Only the fixed list of ids below is ever read.
 */
import { applyEntries, pickCurrent } from './scrollspy-state';

const ORDER = ['uvod', 'o-mne', 'portfolio', 'reference', 'kontakt'] as const;

export function startScrollspy(root: Document = document): void {
  if (!('IntersectionObserver' in window)) return;
  const sections = ORDER.map((id) => root.getElementById(id)).filter((el): el is HTMLElement => el !== null);
  if (sections.length === 0) return;
  const links = [...root.querySelectorAll<HTMLAnchorElement>('[data-nav-anchor]')];

  let visible = new Set<string>();
  const mark = (): void => {
    const id = pickCurrent(ORDER, visible);
    for (const link of links) {
      if (link.dataset.navAnchor === id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  };

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
