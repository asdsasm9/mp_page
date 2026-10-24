// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { DESKTOP_QUERY, enhanceMenu } from './menu';

let changeListener: ((e: { matches: boolean }) => void) | null = null;
let queried = '';

function setup(): { menu: HTMLDetailsElement; summary: HTMLElement; link: HTMLAnchorElement } {
  document.body.innerHTML = `
    <a class="skip-link" href="#obsah">Přeskočit</a>
    <header>
      <details class="menu" data-menu>
        <summary>Menu</summary>
        <div class="drawer"><nav><a href="/portfolio/">Portfolio</a></nav><p>text</p></div>
      </details>
    </header>
    <main id="obsah"><button>x</button></main>
    <footer>f</footer>`;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => {
      queried = q;
      return {
        matches: false,
        addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => {
          changeListener = fn;
        },
      };
    },
  });
  const menu = document.querySelector<HTMLDetailsElement>('details')!;
  enhanceMenu(menu, document);
  return { menu, summary: menu.querySelector('summary')!, link: menu.querySelector('a')! };
}

const open = async (menu: HTMLDetailsElement): Promise<void> => {
  menu.open = true;
  await new Promise((r) => setTimeout(r, 0)); // the toggle event is queued
};
const inertOf = (selector: string): boolean => document.querySelector<HTMLElement>(selector)!.hasAttribute('inert');

describe('menu enhancement', () => {
  beforeEach(() => {
    changeListener = null;
    queried = '';
  });

  it('Escape closes the drawer and returns focus to the burger', async () => {
    const { menu, summary, link } = setup();
    await open(menu);
    link.focus();
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it('other keys leave it open', async () => {
    const { menu, link } = setup();
    await open(menu);
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(menu.open).toBe(true);
  });

  it('a click on a link closes it', async () => {
    const { menu, link } = setup();
    await open(menu);
    link.addEventListener('click', (e) => e.preventDefault());
    link.click();
    expect(menu.open).toBe(false);
  });

  it('a click on the backdrop (the details element itself) closes it, a click on the panel does not', async () => {
    const { menu } = setup();
    await open(menu);
    menu.querySelector('.drawer p')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(menu.open).toBe(true);
    menu.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(menu.open).toBe(false);
  });

  it('sets inert on main, footer and the skip link while open and removes it on close', async () => {
    const { menu } = setup();
    expect([inertOf('main'), inertOf('footer'), inertOf('.skip-link')]).toEqual([false, false, false]);
    await open(menu);
    expect([inertOf('main'), inertOf('footer'), inertOf('.skip-link')]).toEqual([true, true, true]);
    menu.open = false;
    await new Promise((r) => setTimeout(r, 0));
    expect([inertOf('main'), inertOf('footer'), inertOf('.skip-link')]).toEqual([false, false, false]);
    expect(document.querySelector('header')!.hasAttribute('inert')).toBe(false);
  });

  it('closes when the viewport grows past the desktop breakpoint', async () => {
    const { menu } = setup();
    expect(queried).toBe(DESKTOP_QUERY);
    await open(menu);
    changeListener!({ matches: false });
    expect(menu.open).toBe(true);
    changeListener!({ matches: true });
    expect(menu.open).toBe(false);
  });
});
