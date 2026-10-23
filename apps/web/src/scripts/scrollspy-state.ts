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
