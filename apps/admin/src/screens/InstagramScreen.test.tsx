/**
 * Instagram preview screen (WP-14 test 11, WP-15): order, carousel mark, empty state, no-photo notice, profile header,
 * filter; chips, next-up, handles, keyboard drag and rollback only with "Řadit příspěvky" on, nothing of that with it off.
 */
import { cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatProfileCount } from '@mp/shared';
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

function mount(world: FakeWorld, url = '/instagram') {
  return render(
    <AppProviders ports={world.ports} retry={false} imgBaseUrl={IMG_BASE} siteUrl="https://site.example.test">
      <MemoryRouter initialEntries={[url]}>
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
const sortToggle = () => screen.getByRole('button', { name: cs.instagram.sort.toggle });
const handleRe = new RegExp(`^${cs.reorder.handle}`);

/** Turns "Řadit příspěvky" on and returns the grid. */
async function startSorting(user: ReturnType<typeof userEvent.setup>) {
  const list = await grid();
  await user.click(sortToggle());
  return list;
}

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

  it('with "Řadit příspěvky" on, planned and draft tiles get a text chip, posted ones a hidden date only', async () => {
    mount(seeded());
    const list = await startSorting(userEvent.setup());
    const open = tiles(list).slice(0, 5);
    expect(open.map((li) => li.getAttribute('data-status'))).toEqual(['draft', 'planned', 'planned', 'draft', 'draft']);
    expect(within(open[0]!).getByText(cs.instagram.statusDraft)).toBeTruthy();
    expect(within(open[1]!).getByText(cs.instagram.statusPlanned)).toBeTruthy();
    const posted = tiles(list).slice(5);
    for (const li of posted) {
      expect(li.getAttribute('data-status')).toBe('posted');
      expect(li.querySelector('.ig-chip')).toBeNull();
      expect(li.textContent).toMatch(/Zveřejněno \d+\. \d+\. \d{4}/);
    }
  });

  it('with "Řadit příspěvky" on, there is exactly one "Další na řadě": the last planned post, next to the posted ones', async () => {
    mount(seeded());
    const list = await startSorting(userEvent.setup());
    const marked = screen.getAllByText(cs.instagram.nextUp);
    expect(marked).toHaveLength(1);
    expect(tiles(list)[2]!.contains(marked[0]!)).toBe(true);
  });

  it('with "Řadit příspěvky" off (the default) the preview shows no handle, chip, status text or "Další na řadě"', async () => {
    mount(seeded());
    const list = await grid();
    expect(sortToggle().getAttribute('aria-pressed')).toBe('false');
    expect(within(list).queryAllByRole('button')).toHaveLength(0);
    expect(list.querySelector('.photo-handle, .ig-chip, .ig-chips, .ig-badge, .ig-badges')).toBeNull();
    for (const text of [cs.instagram.statusDraft, cs.instagram.statusPlanned, cs.instagram.nextUp]) expect(within(list).queryByText(text)).toBeNull();
    expect(document.body.textContent).not.toContain(cs.reorder.listHint);
    expect(list.hasAttribute('aria-describedby')).toBe(false);
    // Tiles are plain links that open the post.
    expect(within(tiles(list)[1]!).getByRole('link').getAttribute('href')).toMatch(/^\/instagram\/[0-9a-f-]+$/);
  });

  it('toggles back off: handles, chips and "Další na řadě" disappear again', async () => {
    mount(seeded());
    const user = userEvent.setup();
    const list = await startSorting(user);
    expect(sortToggle().getAttribute('aria-pressed')).toBe('true');
    expect(within(list).getAllByRole('button', { name: handleRe })).toHaveLength(5);
    await user.click(sortToggle());
    expect(sortToggle().getAttribute('aria-pressed')).toBe('false');
    expect(within(list).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByText(cs.instagram.nextUp)).toBeNull();
  });

  it('marks a carousel with a plain icon: no pill and no visible count, the count is in the accessible name', async () => {
    mount(seeded());
    const list = await grid();
    const carousel = list.querySelector<HTMLElement>('.ig-carousel')!;
    expect(carousel.querySelector('svg')).toBeTruthy();
    expect(carousel.textContent).toBe(cs.instagram.carousel.replace('{photos}', '3 fotky'));
    expect(carousel.querySelector('[aria-hidden="true"]:not(svg)')).toBeNull();
    expect(carousel.querySelector('.visually-hidden')).toBeTruthy();
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

  it('has no legend, swatch or dashed outline any more', async () => {
    mount(seeded());
    await grid();
    expect(document.querySelector('.ig-legend, .ig-swatch')).toBeNull();
    expect(screen.queryByRole('list', { name: /legenda/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/čárkovaně/i);
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
    await startSorting(user);
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
    await startSorting(user);
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

  it('with "Řadit příspěvky" on, there is a drag handle only on planned and draft tiles', async () => {
    mount(seeded());
    const list = await startSorting(userEvent.setup());
    expect(within(list).getAllByRole('button', { name: handleRe })).toHaveLength(5);
  });

  it('axe: no serious or critical violations with "Řadit příspěvky" on', async () => {
    mount(seeded());
    await startSorting(userEvent.setup());
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(await seriousViolations()).toEqual([]);
  });
});

describe('Instagram profile header', () => {
  const photoId = (world: FakeWorld) => (world.snapshot().photos as { id: string }[])[0]!.id;

  it('shows the default profile as a region with the username as h2, initials and counts with visible words', async () => {
    mount(seeded());
    await grid();
    const frame = screen.getByRole('region', { name: cs.instagram.profile.label });
    expect(within(frame).getByRole('heading', { level: 2, name: 'mullnyphotos' })).toBeTruthy();
    const counts = within(frame).getByRole('list', { name: cs.instagram.profile.countsLabel });
    expect(within(counts).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '9 příspěvků',
      '0 sledujících',
      '0 sleduje',
    ]);
    expect(within(frame).getByText('Mullny Photos')).toBeTruthy();
    const initials = frame.querySelector('.ig-avatar-initials')!;
    expect(initials.textContent).toBe('MP');
    expect(initials.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByText(cs.instagram.profile.loadFailed)).toBeNull();
  });

  it('shows the typed profile: formatted counts, bio with line breaks as text, link as plain text, avatar as a sharp image', async () => {
    const world = seeded();
    await world.ports.planner.updateProfile({
      username: 'mullny.photos',
      display_name: 'Fotograf Mullny',
      bio: 'Řádek 1\nŘádek 2 <b>tučně</b> https://example.test/bio',
      link: 'https://example.test/odkaz',
      followers_count: 12345,
      following_count: 87,
      avatar_photo_id: photoId(world),
    });
    mount(world);
    await grid();
    const frame = screen.getByRole('region', { name: cs.instagram.profile.label });
    const counts = within(frame).getByRole('list', { name: cs.instagram.profile.countsLabel });
    expect(within(counts).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['9 příspěvků', `${formatProfileCount(12345)} sledujících`, '87 sleduje']);
    expect(formatProfileCount(12345)).toMatch(/^12,3\s+tis\.$/);
    const bio = frame.querySelector<HTMLElement>('.ig-bio')!;
    expect(bio.textContent).toBe('Řádek 1\nŘádek 2 <b>tučně</b> https://example.test/bio');
    expect(bio.querySelector('b, a')).toBeNull();
    const link = frame.querySelector<HTMLElement>('.ig-profile-link')!;
    expect(link.textContent).toBe('https://example.test/odkaz');
    expect(link.closest('a')).toBeNull();
    expect(frame.querySelector('.ig-profile a, .ig-profile button, .ig-profile [href]')).toBeNull();
    const img = frame.querySelector<HTMLImageElement>('.ig-avatar')!;
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('src')).toMatch(/^https:\/\/img\.example\.test\/photos\/[0-9a-f-]+\/480\.webp$/);
    expect(img.getAttribute('srcset')).toMatch(/\/480\.webp 480w, .*\/720\.webp 720w$/);
    expect(frame.querySelector('.ig-avatar-initials')).toBeNull();
  });

  it('keeps the decorative buttons and tab row out of the accessibility tree and has no working button yet', async () => {
    mount(seeded());
    await grid();
    const frame = screen.getByRole('region', { name: cs.instagram.profile.label });
    for (const el of frame.querySelectorAll('.ig-actions, .ig-tabs')) expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(within(frame).queryByRole('button', { name: cs.instagram.profile.archive })).toBeNull();
    expect(frame.querySelector('.ig-profile button, .ig-profile a')).toBeNull();
  });

  it('falls back to the defaults with a notice when the profile cannot load, and the grid does not wait for it', async () => {
    const world = seeded();
    world.failNext('planner.getProfile', 'network', 1);
    mount(world);
    await grid();
    expect(await screen.findByText(cs.instagram.profile.loadFailed)).toBeTruthy();
    const frame = screen.getByRole('region', { name: cs.instagram.profile.label });
    expect(within(frame).getByRole('heading', { level: 2, name: 'mullnyphotos' })).toBeTruthy();
    expect(within(frame).getByText('Mullny Photos')).toBeTruthy();
    expect(tiles(await grid())).toHaveLength(9);
  });

  it('shows the posts while the profile is still loading', async () => {
    const world = seeded();
    world.ports.planner.getProfile = () => new Promise(() => undefined);
    mount(world);
    expect(tiles(await grid())).toHaveLength(9);
    expect(document.querySelector('.ig-profile-pending')?.getAttribute('aria-busy')).toBe('true');
  });
});

describe('Instagram filter', () => {
  const radio = (name: string) => screen.getByRole('radio', { name: new RegExp(`^${name}`) });

  it('is a native radio group "Zobrazit" with counts, "Vše" chosen by default', async () => {
    mount(seeded());
    await grid();
    const group = screen.getByRole('group', { name: cs.instagram.filter.legend });
    expect(within(group).getAllByRole('radio').map((r) => (r as HTMLInputElement).checked)).toEqual([true, false, false]);
    expect(radio('Vše').closest('label')!.textContent).toBe('Vše9');
    expect(radio('Zveřejněné').closest('label')!.textContent).toBe('Zveřejněné4');
    expect(radio('Naplánované').closest('label')!.textContent).toBe('Naplánované5');
    expect(screen.getByText('Zobrazeno 9 příspěvků').getAttribute('aria-live')).toBe('polite');
  });

  it('filters the grid, updates the post count and the live region, and keeps the choice in the URL', async () => {
    mount(seeded());
    const list = await grid();
    const user = userEvent.setup();
    await user.click(radio('Zveřejněné'));
    expect(tiles(list)).toHaveLength(4);
    expect(tiles(list).every((li) => li.getAttribute('data-status') === 'posted')).toBe(true);
    expect(screen.getByText('Zobrazeno 4 příspěvků')).toBeTruthy();
    expect(screen.getByRole('list', { name: cs.instagram.profile.countsLabel }).textContent).toContain('4 příspěvků');
    await user.click(radio('Naplánované'));
    expect(tiles(list)).toHaveLength(5);
    expect(screen.getByText('Zobrazeno 5 příspěvků')).toBeTruthy();
    await user.click(radio('Vše'));
    expect(tiles(list)).toHaveLength(9);
  });

  it.each([
    ['?zobrazit=zverejnene', 4, 'Zveřejněné'],
    ['?zobrazit=naplanovane', 5, 'Naplánované'],
    ['?zobrazit=vse', 9, 'Vše'],
    ['?zobrazit=neco', 9, 'Vše'],
    ['', 9, 'Vše'],
  ])('reads the URL %s: %i tiles, "%s" chosen', async (query, n, chosen) => {
    mount(seeded(), `/instagram${query}`);
    expect(tiles(await grid())).toHaveLength(n);
    expect((radio(chosen) as HTMLInputElement).checked).toBe(true);
  });

  it('moves between the options with the arrow keys', async () => {
    mount(seeded());
    const list = await grid();
    const user = userEvent.setup();
    radio('Vše').focus();
    await user.keyboard('{ArrowRight}');
    expect((radio('Zveřejněné') as HTMLInputElement).checked).toBe(true);
    expect(tiles(list)).toHaveLength(4);
    await user.keyboard('{ArrowRight}');
    expect((radio('Naplánované') as HTMLInputElement).checked).toBe(true);
    expect(tiles(list)).toHaveLength(5);
  });

  it('disables "Řadit příspěvky" under "Zveřejněné" with a note, and shows no handles there', async () => {
    mount(seeded());
    const user = userEvent.setup();
    await startSorting(user);
    expect(screen.getAllByRole('button', { name: handleRe })).toHaveLength(5);
    await user.click(radio('Zveřejněné'));
    const toggle = sortToggle() as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText(cs.instagram.sort.postedNote)).toBeTruthy();
    expect(toggle.getAttribute('aria-describedby')).toBe(screen.getByText(cs.instagram.sort.postedNote).id);
    expect(screen.queryAllByRole('button', { name: handleRe })).toHaveLength(0);
    await user.click(radio('Naplánované'));
    expect((sortToggle() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(cs.instagram.sort.postedNote)).toBeNull();
  });

  it('shows a text when nothing is posted or nothing is planned', async () => {
    const noOpen = seeded();
    for (const p of await noOpen.ports.planner.listPosts()) if (p.status !== 'posted') await noOpen.ports.planner.deletePost(p.id);
    mount(noOpen, '/instagram?zobrazit=naplanovane');
    expect(await screen.findByText(cs.instagram.filter.emptyPlanned)).toBeTruthy();
    expect(screen.getByText('Zobrazeno 0 příspěvků')).toBeTruthy();
    expect(screen.queryByRole('list', { name: cs.instagram.gridLabel })).toBeNull();
    cleanup();
    const noPosted = seeded();
    for (const p of await noPosted.ports.planner.listPosts()) if (p.status === 'posted') await noPosted.ports.planner.deletePost(p.id);
    mount(noPosted, '/instagram?zobrazit=zverejnene');
    expect(await screen.findByText(cs.instagram.filter.emptyPosted)).toBeTruthy();
  });

  it('axe: no serious or critical violations in the filtered views', async () => {
    mount(seeded(), '/instagram?zobrazit=zverejnene');
    await grid();
    expect(await seriousViolations()).toEqual([]);
  });
});
