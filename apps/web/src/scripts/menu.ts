/**
 * Menu enhancement. The menu is a native <details>, so it works without this script; this only adds
 * Escape to close (focus returns to the toggle) and closes the menu when a link inside it is used.
 */
export function enhanceMenu(menu: HTMLDetailsElement): void {
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !menu.open) return;
    menu.open = false;
    menu.querySelector('summary')?.focus();
  });
  menu.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a')) menu.open = false;
  });
}

for (const menu of document.querySelectorAll<HTMLDetailsElement>('details[data-menu]')) enhanceMenu(menu);
