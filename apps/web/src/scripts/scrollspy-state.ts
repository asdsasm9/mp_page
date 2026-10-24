/**
 * Which section is "current" while the home page scrolls. `order` is the document order of the section ids,
 * `visible` the ids currently inside the observed band. The last visible section in document order wins
 * (the one that has most recently reached the band). Returns null when none is visible.
 */
export function pickCurrent(order: readonly string[], visible: ReadonlySet<string>): string | null {
  let current: string | null = null;
  for (const id of order) if (visible.has(id)) current = id;
  return current;
}

/**
 * The `aria-current` value a header link gets on the home page. `navAnchor` is the link's data-nav-anchor,
 * `sectionId` the section in view (null when none). Úvod ("home") is `page` while the hero (`uvod`) is in view
 * or the page is at the very top; other home-anchor links are `location` while their section is in view.
 */
export function homeMarker(
  navAnchor: string,
  sectionId: string | null,
  atTop: boolean,
): 'page' | 'location' | null {
  if (navAnchor === 'home') return sectionId === 'uvod' || (sectionId === null && atTop) ? 'page' : null;
  return navAnchor === sectionId ? 'location' : null;
}

/** Apply an IntersectionObserver batch to the visible set (pure: returns a new set). */
export function applyEntries(
  visible: ReadonlySet<string>,
  entries: ReadonlyArray<{ readonly id: string; readonly isIntersecting: boolean }>,
): Set<string> {
  const next = new Set(visible);
  for (const e of entries) {
    if (e.isIntersecting) next.add(e.id);
    else next.delete(e.id);
  }
  return next;
}
