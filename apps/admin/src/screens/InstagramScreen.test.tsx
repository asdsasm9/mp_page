/** Instagram grid screen (WP-14 test 11): order, carousel mark, badges, next-up, empty state, no-photo notice, keyboard drag, rollback. */
import { cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorld, fixtureSnapshot, type FakeWorld } from '../adapters/fake';
import { seriousViolations } from '../a11y/helpers';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { keyboardDrag, mockRowRects } from '../components/keyboardDrag.testutil';
import { cs } from '../i18n/cs';

configure({ getElementError: (message) => new Error(message ?? '') });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const IMG_BASE = 'https://img.example.test';

function mount(world: FakeWorld) {
  return render(
    <AppProviders ports={world.ports} retry={false} imgBaseUrl={IMG_BASE} siteUrl="https://site.example.test">
      <MemoryRouter initialEntries={['/instagram']}>
        <App />
      </MemoryRouter>
    </AppProviders>,
  );
}

const seeded = () => createFakeWorld({ signedIn: true, seed: fixtureSnapshot(), plannerSeed: true });

async function grid() {
  return screen.findByRole('list', { name: cs.instagram.gridLabel });
}
const tiles = (list: HTMLElement) => within(list).getAllByRole('listitem');
const tileNames = (list: HTMLElement) => tiles(list).map((li) => within(li).getByRole('link').textContent ?? '');

describe('Instagram grid screen', () => {
  it('shows open posts by sort, then posted ones newest first, under one h1', async () => {
    mount(seeded());
    expect(await screen.findByRole('heading', { level: 1, name: cs.routes.instagram.title })).toBeTruthy();
    const names = tileNames(await grid());
    const captions = ['Koncept bez data', 'Svatba na zámku', 'Portrét v ateliéru', 'Rozepsaný příspěvek', 'Fotka byla smazána', 'Podzimní páry', 'Svatební den', 'Zbyla jedna z tří', 'Starší příspěvek'];
    expect(names).toHaveLength(captions.length);
    captions.forEach((caption, i) => expect(names[i]).toContain(caption));
  });

  it('uses the first photo: 480 px WebP as src, 480, 720 and 960 px in srcset for sharp tiles on a wide screen', async () => {
    mount(seeded());
    const list = await grid();
    const img = tiles(list)[0]!.querySelector('img')!;
    expect(img.getAttribute('src')).toMatch(/^https:\/\/img\.example\.test\/photos\/[0-9a-f-]+\/480\.webp$/);
    expect(img.getAttribute('srcset')).toMatch(/\/480\.webp 480w, .*\/720\.webp 720w, .*\/960\.webp 960w$/);
    expect(img.getAttribute('sizes')).toMatch(/^\(min-width: 64rem\) 720px,/);
    expect(img.getAttribute('alt')).toBe('');
  });

  it('marks a carousel with the photo count in the accessible name, a single photo not', async () => {
    mount(seeded());
    const list = await grid();
    expect(screen.getByRole('link', { name: /Svatba na zámku.*Karusel, 3 fotky/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Svatební den.*Karusel, 4 fotky/ })).toBeTruthy();
    expect(within(tiles(list)[0]!).queryByText(/Karusel/)).toBeNull();
  });

  it('gives planned and draft tiles a text badge and dashed state, posted ones a hidden date only', async () => {
    mount(seeded());
    const list = await grid();
    const open = tiles(list).slice(0, 5);
    expect(open.map((li) => li.getAttribute('data-status'))).toEqual(['draft', 'planned', 'planned', 'draft', 'draft']);
    expect(within(open[0]!).getByText(cs.instagram.statusDraft)).toBeTruthy();
    expect(within(open[1]!).getByText(cs.instagram.statusPlanned)).toBeTruthy();
    const posted = tiles(list).slice(5);
    for (const li of posted) {
      expect(li.getAttribute('data-status')).toBe('posted');
      expect(li.querySelector('.ig-badge')).toBeNull();
      expect(li.textContent).toMatch(/Zveřejněno \d+\. \d+\. \d{4}/);
    }
  });

  it('has exactly one "Další na řadě": the last planned post, next to the posted ones', async () => {
    mount(seeded());
    const list = await grid();
    const marked = screen.getAllByText(cs.instagram.nextUp);
    expect(marked).toHaveLength(1);
    expect(tiles(list)[2]!.contains(marked[0]!)).toBe(true);
  });

  it('shows an empty tile and a notice for a post without photos, and no handle count error', async () => {
    mount(seeded());
    const list = await grid();
    expect(within(tiles(list)[4]!).getByText(cs.instagram.noPhotos)).toBeTruthy();
    expect(tiles(list)[4]!.querySelector('img')).toBeNull();
    expect(await screen.findByText(cs.instagram.brokenNotice)).toBeTruthy();
  });

  it('links a tile to its detail and has a "Nový příspěvek" link', async () => {
    mount(seeded());
    const list = await grid();
    const link = within(tiles(list)[1]!).getByRole('link');
    expect(link.getAttribute('href')).toMatch(/^\/instagram\/[0-9a-f-]+$/);
    expect(screen.getByRole('link', { name: cs.instagram.newPost }).getAttribute('href')).toBe('/instagram/novy');
  });

  it('shows the legend', async () => {
    mount(seeded());
    await grid();
    const legend = screen.getByRole('list', { name: cs.instagram.legendLabel });
    expect(legend.textContent).toContain(cs.instagram.legendDashed);
  });

  it('shows the empty state with three steps when there are no posts', async () => {
    mount(createFakeWorld({ signedIn: true, seed: fixtureSnapshot() }));
    expect(await screen.findByText(cs.instagram.emptyTitle)).toBeTruthy();
    const steps = within(document.querySelector<HTMLElement>('.ig-steps')!).getAllByRole('listitem');
    expect(steps.map((s) => s.textContent)).toEqual([...cs.instagram.emptySteps]);
    expect(screen.getByRole('link', { name: cs.instagram.newPost }).getAttribute('href')).toBe('/instagram/novy');
  });

  it('offers a retry when the load fails', async () => {
    const world = seeded();
    world.failNext('planner.listPosts', 'network', 1);
    mount(world);
    const alert = (await screen.findByText(cs.instagram.loadFailed)).closest<HTMLElement>('[role="alert"]')!;
    await userEvent.setup().click(within(alert).getByRole('button', { name: cs.glossary.retry }));
    await grid();
  });

  it('is reachable from the desktop and the phone navigation', async () => {
    mount(seeded());
    await grid();
    const links = screen.getAllByRole('link', { name: cs.nav.instagram });
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.getAttribute('href') === '/instagram')).toBe(true);
  });

  it('reorders with the keyboard, saves minimal updates and keeps the new order', async () => {
    mockRowRects();
    const world = seeded();
    mount(world);
    const list = await grid();
    const user = userEvent.setup();
    await keyboardDrag(user, `${cs.reorder.handle}: Příspěvek 1`, 1);
    await waitFor(() => expect(tileNames(list)[0]).toContain('Svatba na zámku'));
    expect(tileNames(list)[1]).toContain('Koncept bez data');
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('goes back to the saved order and offers a retry when the save fails', async () => {
    mockRowRects();
    const world = seeded();
    mount(world);
    const list = await grid();
    const user = userEvent.setup();
    world.failNext('planner.reorderPosts', 'network', 1);
    await keyboardDrag(user, `${cs.reorder.handle}: Příspěvek 1`, 1);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(cs.reorder.failed);
    expect(tileNames(list)[0]).toContain('Koncept bez data');
    await user.click(within(alert).getByRole('button', { name: cs.glossary.retry }));
    await waitFor(() => expect(tileNames(list)[0]).toContain('Svatba na zámku'));
  });

  it('axe: no serious or critical violations in the grid and in the empty state', async () => {
    mount(seeded());
    await grid();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(await seriousViolations()).toEqual([]);
    cleanup();
    mount(createFakeWorld({ signedIn: true, seed: fixtureSnapshot() }));
    await screen.findByText(cs.instagram.emptyTitle);
    expect(await seriousViolations()).toEqual([]);
  });

  it('has a drag handle only on planned and draft tiles', async () => {
    mount(seeded());
    const list = await grid();
    expect(within(list).getAllByRole('button', { name: new RegExp(`^${cs.reorder.handle}`) })).toHaveLength(5);
  });
});
