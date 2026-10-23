/**
 * Menu enhancement. The drawer is a native <details> and opens, closes (the burger doubles as the close
 * button) and navigates without this script. This adds, on top:
 *  - Escape closes and focus returns to the burger (the <summary>),
 *  - a click on a link inside the drawer closes it,
 *  - a click on the backdrop (the <details> element itself, outside the panel) closes it,
 *  - while open, `inert` on <main>, the footer and the skip link so focus cannot reach the page behind,
 *  - growing past the desktop breakpoint closes it.
 */
const BEHIND = ['main', 'footer', '.skip-link'] as const;
export const DESKTOP_QUERY = '(min-width: 47.5rem)';

export function enhanceMenu(menu: HTMLDetailsElement, doc: Document = menu.ownerDocument): void {
  const setInert = (on: boolean): void => {
    for (const selector of BEHIND) {
      for (const el of doc.querySelectorAll<HTMLElement>(selector)) el.toggleAttribute('inert', on);
    }
  };
  const close = (): void => {
    menu.open = false;
  };

  menu.addEventListener('toggle', () => setInert(menu.open));
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !menu.open) return;
    close();
    menu.querySelector('summary')?.focus();
  });
  menu.addEventListener('click', (event) => {
    const target = event.target as Element;
    if (target.closest('a') || target === menu) close();
  });

  const view = doc.defaultView;
  if (view?.matchMedia) {
    view.matchMedia(DESKTOP_QUERY).addEventListener('change', (event) => {
      if (event.matches) close();
    });
  }
}

if (typeof document !== 'undefined') {
  for (const menu of document.querySelectorAll<HTMLDetailsElement>('details[data-menu]')) enhanceMenu(menu);
}
