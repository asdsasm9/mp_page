/**
 * WP5-27 audit, part 3: prefers-reduced-motion produces no transitions, and focus is not lost when the
 * control that has it becomes disabled or disappears.
 */
import { act, cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cs, glossary } from '../i18n/cs';
import { heading1, makeWorld, mount, tabTo } from './helpers';

configure({ getElementError: (message) => new Error(message ?? '') });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  Reflect.deleteProperty(window, 'matchMedia');
});

const stylesDir = `${import.meta.dirname}/../styles`;

/** Every motion declaration with the at-rules it sits in. Comments are removed first. */
function motionDeclarations(css: string): { text: string; context: string[] }[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const stack: string[] = [];
  const found: { text: string; context: string[] }[] = [];
  let buffer = '';
  for (const ch of source) {
    if (ch === '{') {
      stack.push(buffer.trim());
      buffer = '';
    } else if (ch === '}') {
      stack.pop();
      buffer = '';
    } else if (ch === ';') {
      const text = buffer.trim();
      if (/^(transition|animation|scroll-behavior)[\w-]*\s*:/.test(text)) found.push({ text, context: [...stack] });
      buffer = '';
    } else buffer += ch;
  }
  // @keyframes blocks count as motion too.
  for (const m of source.matchAll(/@keyframes\s+[\w-]+/g)) found.push({ text: m[0], context: [] });
  return found;
}

describe('prefers-reduced-motion', () => {
  it('every transition, animation and smooth scroll in the CSS sits inside (prefers-reduced-motion: no-preference)', () => {
    const files = ['app.css', 'tokens.css'];
    let total = 0;
    for (const file of files) {
      for (const d of motionDeclarations(readFileSync(`${stylesDir}/${file}`, 'utf8'))) {
        total++;
        if (/^(transition|animation)[\w-]*\s*:\s*none\s*$/.test(d.text)) continue;
        expect(
          d.context.some((c) => /prefers-reduced-motion:\s*no-preference/.test(c)),
          `${file}: ${d.text} (${d.context.join(' > ')})`,
        ).toBe(true);
      }
    }
    expect(total).toBeGreaterThan(0);
  });

  it('with the reduce preference no element gets an inline transition (sortable lists and the photo grid)', async () => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion: reduce'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
      onchange: null,
    })) as typeof window.matchMedia;
    const world = makeWorld();
    const snapshot = world.snapshot();
    const album = (snapshot.albums as { id: string; title: string; category_id: string }[])[0]!;
    mount(world, '/');
    await heading1(cs.routes.categories.title);
    await screen.findByRole('list', { name: cs.categories.listLabel });
    expect(document.querySelectorAll('[style*="transition"]')).toHaveLength(0);
    cleanup();
    mount(world, `/alba/${album.id}`);
    await heading1(album.title);
    await screen.findByRole('list', { name: cs.photos.gridLabel });
    expect(document.querySelectorAll('[style*="transition"]')).toHaveLength(0);
  });
});

describe('focus is not lost', () => {
  it('a busy dialog button keeps keyboard focus (aria-disabled, not disabled) and focus returns to the opener afterwards', async () => {
    const world = makeWorld();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const real = world.ports.catalog.createCategory.bind(world.ports.catalog);
    world.ports.catalog.createCategory = async (input) => {
      await gate;
      return real(input);
    };
    const user = userEvent.setup();
    mount(world, '/');
    await heading1(cs.routes.categories.title);
    const opener = await screen.findByRole('button', { name: glossary.newCategory });
    await tabTo(user, opener);
    await user.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: glossary.newCategory });
    await user.keyboard('Ticho');
    const submit = screen.getByRole('button', { name: cs.categories.create });
    await tabTo(user, submit);
    await user.keyboard('{Enter}');

    const busy = await screen.findByRole('button', { name: cs.categories.saving });
    expect(busy).toBe(submit);
    expect(busy.hasAttribute('disabled')).toBe(false);
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(busy);

    await act(async () => release());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('a control that gets disabled while it has focus (going offline) hands focus to a neighbour, not to the page body', async () => {
    const world = makeWorld();
    const user = userEvent.setup();
    mount(world, '/ulozeni');
    await heading1(cs.routes.storage.title);
    await screen.findByRole('table', { name: cs.storageScreen.breakdownCaption });
    const check = screen.getByRole('button', { name: glossary.checkStorage });
    await tabTo(user, check);
    expect(document.activeElement).toBe(check);

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });
    await waitFor(() => expect((check as HTMLButtonElement).disabled).toBe(true));
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.activeElement).not.toBe(check);
    expect((document.activeElement as HTMLElement).hasAttribute('disabled')).toBe(false);

    // Back online while still mounted: TanStack's online manager is global and would otherwise stay paused.
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect((check as HTMLButtonElement).disabled).toBe(false));
  });

  it('a focused element that is removed hands focus to the main region', async () => {
    const world = makeWorld();
    mount(world, '/ulozeni');
    await heading1(cs.routes.storage.title);
    const link = within(await screen.findByRole('table', { name: cs.storageScreen.breakdownCaption })).getAllByRole('link')[0]!;
    link.focus();
    expect(document.activeElement).toBe(link);
    link.remove();
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('main')));
  });
});
