import axe from 'axe-core';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeWorld } from './adapters/fake';
import { App } from './App';
import { AppProviders } from './AppProviders';
import { cs } from './i18n/cs';

afterEach(cleanup);

/** The app on the fake world, signed in unless the test is about the login screen. */
async function renderAt(path: string, signedIn = path !== '/prihlaseni') {
  const world = createFakeWorld({ signedIn });
  const view = render(
    <AppProviders ports={world.ports} retry={false}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AppProviders>,
  );
  await screen.findByRole('heading', { level: 1 });
  return { world, ...view };
}

const ROUTES: Array<[string, string]> = [
  ['/prihlaseni', cs.routes.login.title],
  ['/', cs.routes.categories.title],
  ['/kategorie/abc', cs.routes.category.title],
  ['/alba/abc', cs.routes.album.title],
  ['/alba/abc/foto/p1', cs.routes.photo.title],
  ['/zverejnit', cs.routes.publish.title],
  ['/ulozeni', cs.routes.storage.title],
  ['/nahravani', cs.routes.upload.title],
  ['/neexistuje', cs.notFound.title],
];

describe('routes', () => {
  it.each(ROUTES)('%s renders exactly one h1 and a main landmark', async (path, title) => {
    await renderAt(path);
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]!.textContent).toBe(title);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    await waitFor(() => expect(document.title).toBe(`${title}${cs.app.titleSeparator}${cs.app.name}`));
  }, 30_000);

  it.each(ROUTES.filter(([p]) => p !== '/prihlaseni'))('%s has banner and navigation landmarks', async (path) => {
    await renderAt(path);
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: cs.nav.main })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: cs.nav.bottom })).toBeTruthy();
  });

  it('the 404 offers a way back', async () => {
    await renderAt('/nic');
    expect(screen.getByRole('link', { name: cs.notFound.back }).getAttribute('href')).toBe('/');
  });

  it('phone bottom nav has Kategorie, Nahrávání, Zveřejnit', async () => {
    await renderAt('/');
    const nav = screen.getByRole('navigation', { name: cs.nav.bottom });
    const labels = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent);
    expect(labels).toEqual([cs.nav.categories, cs.nav.upload, cs.nav.publish]);
  });

  it('marks the current page in the navigation', async () => {
    await renderAt('/zverejnit');
    const current = screen.getAllByRole('link', { current: 'page' });
    expect(current.length).toBeGreaterThan(0);
    for (const a of current) expect(a.getAttribute('href')).toBe('/zverejnit');
  });
});

describe('keyboard', () => {
  it('the first Tab stop is the skip link and it targets main', async () => {
    const user = userEvent.setup();
    await renderAt('/');
    await user.tab();
    const skip = screen.getByRole('link', { name: cs.skipLink });
    expect(document.activeElement).toBe(skip);
    expect(skip.getAttribute('href')).toBe(`#${screen.getByRole('main').id}`);
  });

  it('login page also starts at the skip link', async () => {
    const user = userEvent.setup();
    await renderAt('/prihlaseni');
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: cs.skipLink }));
  });

  it('moves focus to main after navigating, not on first render', async () => {
    const user = userEvent.setup();
    await renderAt('/');
    expect(document.activeElement).toBe(document.body);
    await user.click(screen.getAllByRole('link', { name: cs.nav.storage })[0]!);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('main')));
  });
});

describe('axe', () => {
  it.each(ROUTES)('%s has no serious or critical violations', async (path) => {
    const { container } = await renderAt(path);
    const result = await axe.run(container, {
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => v.id)).toEqual([]);
  });
});
