/** Home hero photo (WP-12 step 28, T-286): the "Úvodní stránka" screen, its block, the picker, the warnings. */
import axe from 'axe-core';
import { DETAIL_MIN_LONG_EDGE, HERO_MIN_MASTER_WIDTH, type AlbumRow, type PhotoRow } from '@mp/shared';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorld, fixtureSnapshot, withQualityExamples, type FakeWorld } from '../adapters/fake';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { markHeroPhotoCleared, resetHeroPhotoNotice, takeHeroPhotoCleared } from '../data/heroPhotoNotice';
import { isLowForHero, isLowResolution } from '../data/photoQuality';
import { cs } from '../i18n/cs';

const t = cs.heroPhoto;
const IMG = 'https://img.test';

beforeEach(() => resetHeroPhotoNotice());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const albumsOf = (world: FakeWorld) => world.snapshot().albums as AlbumRow[];
const photosOf = (world: FakeWorld) => world.snapshot().photos as PhotoRow[];

/** The fixture with the quality examples; the hero starts unchosen. */
async function setup() {
  const world = createFakeWorld({ signedIn: true, seed: withQualityExamples(fixtureSnapshot()) });
  await world.ports.catalog.updateSiteSettings({ hero_photo_id: null });
  // The album of the quality examples: a 1480 px landscape, two 3000 px landscapes and a 1500 x 2250 portrait.
  const example = photosOf(world).find((p) => p.width === 3000)!;
  const album = albumsOf(world).find((a) => a.id === example.album_id)!;
  const inAlbum = photosOf(world)
    .filter((p) => p.album_id === album.id)
    .sort((a, b) => a.sort - b.sort);
  const low = inAlbum.find(isLowResolution)!;
  return { world, album, low, inAlbum, wide: inAlbum.find((p) => p.width >= HERO_MIN_MASTER_WIDTH)! };
}

function mount(world: FakeWorld, path = '/uvodni-stranka') {
  return render(
    <AppProviders ports={world.ports} retry={false} imgBaseUrl={IMG}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AppProviders>,
  );
}

const block = () => screen.getByRole('region', { name: t.heading });

async function open(world: FakeWorld) {
  const view = mount(world);
  await screen.findByRole('heading', { level: 1, name: cs.routes.homePage.title });
  await screen.findByRole('region', { name: t.heading });
  await waitFor(() => expect(within(block()).getByRole('button', { name: /^(Vybrat|Změnit)$/ })).toHaveProperty('disabled', false));
  return view;
}

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(block()).getByRole('button', { name: /^(Vybrat|Změnit)$/ }));
  return screen.findByRole('dialog', { name: t.picker.title });
}

const photoRadios = (dialog: HTMLElement) =>
  within(dialog)
    .getAllByRole('radio')
    .filter((r) => r.getAttribute('name') === 'hero-photo') as HTMLInputElement[];

describe('threshold', () => {
  it('HERO_MIN_MASTER_WIDTH is 2400 and separate from the D-21 constant', () => {
    expect(HERO_MIN_MASTER_WIDTH).toBe(2400);
    expect(DETAIL_MIN_LONG_EDGE).toBe(2000);
  });

  it('judges the master width, not the long edge', () => {
    expect(isLowForHero({ width: 2400, height: 1600 })).toBe(false);
    expect(isLowForHero({ width: 2399, height: 1600 })).toBe(true);
    // A 1500 x 2250 portrait is not "low resolution" (long edge 2250) but far too narrow for a full-width hero.
    expect(isLowResolution({ width: 1500, height: 2250 })).toBe(false);
    expect(isLowForHero({ width: 1500, height: 2250 })).toBe(true);
    expect(isLowForHero({ width: 1480, height: 987 })).toBe(true);
  });
});

describe('block states', () => {
  it('nothing chosen: "Automaticky (výchozí)", "Vybrat", no crops, no "Zrušit výběr"', async () => {
    const { world } = await setup();
    await open(world);
    expect(within(block()).getByText(t.auto)).toBeTruthy();
    expect(within(block()).getByRole('button', { name: t.choose })).toBeTruthy();
    expect(within(block()).queryByRole('button', { name: t.clear })).toBeNull();
    expect(block().querySelector('img')).toBeNull();
  });

  it('chosen: the album, both crops from the image host, "Změnit" and "Zrušit výběr"', async () => {
    const { world, album, wide } = await setup();
    await world.ports.catalog.updateSiteSettings({ hero_photo_id: wide.id });
    await open(world);
    expect(within(block()).getByText((text) => text.startsWith('Fotka z alba') && text.endsWith(album.title))).toBeTruthy();
    const imgs = [...block().querySelectorAll('img')];
    expect(imgs).toHaveLength(2);
    for (const img of imgs) expect(img.getAttribute('src')).toBe(`${IMG}/photos/${wide.id}/960.webp`);
    expect(within(block()).getByText(t.previewDesktop)).toBeTruthy();
    expect(within(block()).getByText(t.previewPhone)).toBeTruthy();
    expect(within(block()).getByRole('button', { name: t.change })).toBeTruthy();
    expect(within(block()).getByRole('button', { name: t.clear })).toBeTruthy();
    expect(within(block()).queryByText(t.lowResolution)).toBeNull();
  });

  it('a chosen low-resolution photo shows "Nízké rozlišení pro velkou fotku"', async () => {
    const { world, low } = await setup();
    await world.ports.catalog.updateSiteSettings({ hero_photo_id: low.id });
    await open(world);
    expect(within(block()).getByText(t.lowResolution)).toBeTruthy();
  });

  it('a chosen photo in an unpublished album or hidden category carries a warning', async () => {
    const { world, album, wide } = await setup();
    await world.ports.catalog.updateSiteSettings({ hero_photo_id: wide.id });
    await world.ports.catalog.updateAlbum(album.id, { published: false });
    await open(world);
    expect(await within(block()).findByText(t.unpublishedAlbum)).toBeTruthy();
  });

  it('no photos at all: the button is disabled with a hint', async () => {
    const world = createFakeWorld({ signedIn: true });
    const category = await world.ports.catalog.createCategory({ slug: 'nic', name: 'Nic' });
    await world.ports.catalog.createAlbum({ category_id: category.id, slug: 'prazdne', title: 'Prázdné' });
    mount(world);
    await screen.findByRole('region', { name: t.heading });
    await waitFor(() => expect(within(block()).getByText(t.emptyHint)).toBeTruthy());
    expect(within(block()).getByRole('button', { name: t.choose })).toHaveProperty('disabled', true);
  });
});

describe('picker', () => {
  it('opens on the first album, picks a photo, saves hero_photo_id and lands in "Zobrazit změny"', async () => {
    const { world, wide } = await setup();
    const user = userEvent.setup();
    await open(world);
    const dialog = await openPicker(user);
    await waitFor(() => expect(photoRadios(dialog).length).toBeGreaterThan(1));
    const radio = photoRadios(dialog).find((r) => r.value === wide.id)!;
    await user.click(radio);
    expect(within(dialog).queryByText(t.lowResolution)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: t.picker.confirm }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(world.snapshot().settings.hero_photo_id).toBe(wide.id);
    const line = world.snapshot().changeLog.find((l) => l.table_name === 'site_settings');
    expect(line).toMatchObject({ kind: 'edited', label: 'Hlavní fotka úvodní stránky', category_id: null });
    await waitFor(() => expect(block().querySelectorAll('img')).toHaveLength(2));
  });

  it('a narrow photo (low verdict or under 2400 px) can be chosen but warns', async () => {
    const { world, inAlbum } = await setup();
    const user = userEvent.setup();
    await open(world);
    const dialog = await openPicker(user);
    await waitFor(() => expect(photoRadios(dialog).length).toBe(inAlbum.length));
    const narrow = inAlbum.filter((p) => isLowForHero(p));
    expect(narrow.length).toBeGreaterThanOrEqual(2); // the 1480 px landscape and the 1500 x 2250 portrait
    for (const photo of narrow) {
      await user.click(photoRadios(dialog).find((r) => r.value === photo.id)!);
      expect(within(dialog).getByText(t.lowResolution)).toBeTruthy();
      expect(within(dialog).getByRole('button', { name: t.picker.confirm })).toHaveProperty('disabled', false);
    }
  });

  it('confirm stays disabled until a photo is picked', async () => {
    const { world } = await setup();
    const user = userEvent.setup();
    await open(world);
    const dialog = await openPicker(user);
    expect(within(dialog).getByRole('button', { name: t.picker.confirm })).toHaveProperty('disabled', true);
  });

  it('"Zrušit výběr" returns to automatic and logs the change', async () => {
    const { world, wide } = await setup();
    await world.ports.catalog.updateSiteSettings({ hero_photo_id: wide.id });
    const user = userEvent.setup();
    await open(world);
    await user.click(within(block()).getByRole('button', { name: t.clear }));
    await waitFor(() => expect(within(block()).getByText(t.auto)).toBeTruthy());
    expect(world.snapshot().settings.hero_photo_id).toBeNull();
    expect(world.snapshot().changeLog.some((l) => l.table_name === 'site_settings')).toBe(true);
    expect(within(block()).queryByText(t.cleared)).toBeNull();
  });

  it('a photo that is gone is refused (NOT_FOUND)', async () => {
    const { world } = await setup();
    await expect(
      world.ports.catalog.updateSiteSettings({ hero_photo_id: '00000000-0000-4000-8000-0000000000ff' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      world.ports.catalog.updateSiteSettings({ hero_photo_id: null, extra: 1 } as never),
    ).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('has no axe violations with the picker open and a low-resolution photo chosen', async () => {
    const { world, low } = await setup();
    const user = userEvent.setup();
    await open(world);
    const dialog = await openPicker(user);
    await waitFor(() => expect(photoRadios(dialog).length).toBeGreaterThan(1));
    await user.click(photoRadios(dialog).find((r) => r.value === low.id)!);
    const result = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});

describe('photo leaves', () => {
  it('deleting the hero photo clears the choice, logs it and explains it on the screen', async () => {
    const { world, wide } = await setup();
    await world.ports.catalog.updateSiteSettings({ hero_photo_id: wide.id });
    await world.ports.api.deletePhotos({ ids: [wide.id] });
    expect(world.snapshot().settings.hero_photo_id).toBeNull();
    expect(world.snapshot().changeLog.some((l) => l.table_name === 'site_settings')).toBe(true);
    markHeroPhotoCleared(); // what the delete action does for the screen that did the deleting
    await open(world);
    expect(within(block()).getByText(t.cleared)).toBeTruthy();
    expect(takeHeroPhotoCleared()).toBe(false); // consumed by the screen
  });

  it('moving the photo to another album keeps the choice', async () => {
    const { world, album, wide } = await setup();
    await world.ports.catalog.updateSiteSettings({ hero_photo_id: wide.id });
    const other = albumsOf(world).find((a) => a.id !== album.id)!;
    await world.ports.catalog.updatePhoto(wide.id, { album_id: other.id });
    expect(world.snapshot().settings.hero_photo_id).toBe(wide.id);
  });

});
