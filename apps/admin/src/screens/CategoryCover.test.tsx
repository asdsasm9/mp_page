/** Main photo of a category (WP-11, T-272): the block on the category screen, its picker, the badge, the cleared notice. */
import axe from 'axe-core';
import { slugify, type AlbumRow, type CategoryRow, type PhotoRow } from '@mp/shared';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorld, fixtureSnapshot, withQualityExamples, type FakeWorld } from '../adapters/fake';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { markCategoryCoverCleared, resetCategoryCoverNotices, takeCategoryCoverCleared } from '../data/categoryCoverNotice';
import { isLowResolution } from '../data/photoQuality';
import { usePhotoActions } from '../data/photoActions';
import { usePhotoDeleter } from '../data/deleteActions';
import { cs } from '../i18n/cs';

const t = cs.categoryCover;
const IMG = 'https://img.test';

beforeEach(() => resetCategoryCoverNotices());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const categoriesOf = (world: FakeWorld) => world.snapshot().categories as CategoryRow[];
const albumsOf = (world: FakeWorld) => world.snapshot().albums as AlbumRow[];
const photosOf = (world: FakeWorld) => world.snapshot().photos as PhotoRow[];
const categoryRow = (world: FakeWorld, id: string) => categoriesOf(world).find((c) => c.id === id)!;

/** The fixture catalog with one low-resolution photo; `category` owns it and starts without a main photo. */
async function setup() {
  const world = createFakeWorld({ signedIn: true, seed: withQualityExamples(fixtureSnapshot()) });
  const low = photosOf(world).find(isLowResolution)!;
  const lowAlbum = albumsOf(world).find((a) => a.id === low.album_id)!;
  const category = categoryRow(world, lowAlbum.category_id);
  await world.ports.catalog.updateCategory(category.id, { cover_photo_id: null });
  const own = albumsOf(world)
    .filter((a) => a.category_id === category.id)
    .sort((a, b) => a.sort - b.sort);
  const other = categoriesOf(world).find((c) => c.id !== category.id)!;
  const otherAlbum = albumsOf(world).find((a) => a.category_id === other.id && photosOf(world).some((p) => p.album_id === a.id))!;
  return { world, category: categoryRow(world, category.id), own, low, lowAlbum, otherAlbum };
}

function mount(world: FakeWorld, path: string, extra?: React.ReactNode) {
  return render(
    <AppProviders ports={world.ports} retry={false} imgBaseUrl={IMG}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        {extra}
      </MemoryRouter>
    </AppProviders>,
  );
}

async function openCategory(world: FakeWorld, category: CategoryRow) {
  const view = mount(world, `/kategorie/${category.id}`);
  await screen.findByRole('heading', { level: 1, name: category.name });
  await screen.findByRole('region', { name: t.heading });
  return view;
}

const block = () => screen.getByRole('region', { name: t.heading });

/** Waits until the block knows every album's photos (the trigger leaves its loading state). */
async function ready() {
  await waitFor(() => expect(within(block()).getByRole('button', { name: /^(Vybrat|Změnit)$/ })).toHaveProperty('disabled', false));
}

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await ready();
  await user.click(within(block()).getByRole('button', { name: /^(Vybrat|Změnit)$/ }));
  return screen.findByRole('dialog', { name: t.picker.title });
}

const photoRadios = (dialog: HTMLElement) =>
  within(dialog)
    .getAllByRole('radio')
    .filter((r) => r.getAttribute('name') === 'cover-photo') as HTMLInputElement[];

describe('block states', () => {
  it('nothing chosen: says "Automaticky", offers "Vybrat", no preview, no "Zrušit výběr"', async () => {
    const { world, category } = await setup();
    await openCategory(world, category);
    await ready();
    expect(within(block()).getByText(t.auto)).toBeTruthy();
    expect(within(block()).getByText(t.autoHint)).toBeTruthy();
    expect(within(block()).getByRole('button', { name: t.choose })).toBeTruthy();
    expect(within(block()).queryByRole('button', { name: t.clear })).toBeNull();
    expect(block().querySelector('img')).toBeNull();
  });

  it('chosen: preview from the image host, the album name, "Změnit" and "Zrušit výběr"', async () => {
    const { world, category, own } = await setup();
    const photo = photosOf(world).find((p) => p.album_id === own[0]!.id)!;
    await world.ports.catalog.updateCategory(category.id, { cover_photo_id: photo.id });
    await openCategory(world, categoryRow(world, category.id));
    await waitFor(() => expect(block().querySelector('img')).not.toBeNull());
    expect(block().querySelector('img')!.getAttribute('src')).toBe(`${IMG}/photos/${photo.id}/480.webp`);
    expect(within(block()).getByText(`Fotka z alba ${own[0]!.title}`)).toBeTruthy();
    expect(within(block()).getByRole('button', { name: t.change })).toBeTruthy();
    expect(within(block()).getByRole('button', { name: t.clear })).toBeTruthy();
    expect(within(block()).queryByText(t.auto)).toBeNull();
  });

  it('an empty category (no photos): the button is disabled and a hint says why', async () => {
    const world = createFakeWorld({ signedIn: true });
    const category = await world.ports.catalog.createCategory({ slug: slugify('Portréty'), name: 'Portréty' });
    await world.ports.catalog.createAlbum({ category_id: category.id, slug: 'prazdne', title: 'Prázdné' });
    await openCategory(world, category);
    await waitFor(() => expect(within(block()).getByText(t.emptyHint)).toBeTruthy());
    expect(within(block()).getByRole('button', { name: t.choose })).toHaveProperty('disabled', true);
  });

  it('a category without albums also shows the disabled state', async () => {
    const world = createFakeWorld({ signedIn: true });
    const category = await world.ports.catalog.createCategory({ slug: 'nic', name: 'Nic' });
    await openCategory(world, category);
    await waitFor(() => expect(within(block()).getByText(t.emptyHint)).toBeTruthy());
    expect(within(block()).getByRole('button', { name: t.choose })).toHaveProperty('disabled', true);
  });

  it('a chosen photo in an unpublished album carries a warning', async () => {
    const { world, category, own } = await setup();
    const photo = photosOf(world).find((p) => p.album_id === own[0]!.id)!;
    await world.ports.catalog.updateCategory(category.id, { cover_photo_id: photo.id });
    await world.ports.catalog.updateAlbum(own[0]!.id, { published: false });
    await openCategory(world, categoryRow(world, category.id));
    expect(await within(block()).findByText(t.unpublishedAlbum)).toBeTruthy();
  });

  it('a published album shows no such warning', async () => {
    const { world, category, own } = await setup();
    const photo = photosOf(world).find((p) => p.album_id === own[0]!.id)!;
    await world.ports.catalog.updateCategory(category.id, { cover_photo_id: photo.id });
    await openCategory(world, categoryRow(world, category.id));
    await waitFor(() => expect(block().querySelector('img')).not.toBeNull());
    expect(within(block()).queryByText(t.unpublishedAlbum)).toBeNull();
  });
});

describe('picker', () => {
  it('opens on the first album, lists its photos as radios and saves the choice with a toast', async () => {
    const user = userEvent.setup();
    const { world, category, own } = await setup();
    const update = vi.spyOn(world.ports.catalog, 'updateCategory');
    await openCategory(world, category);
    const dialog = await openPicker(user);
    const albums = within(dialog).getAllByRole('radio').filter((r) => r.getAttribute('name') === 'cover-album') as HTMLInputElement[];
    expect(albums.map((r) => r.checked)).toContain(true);
    expect(albums[0]!.checked).toBe(true);
    expect(document.activeElement).toBe(albums[0]);
    const radios = photoRadios(dialog);
    expect(radios).toHaveLength(photosOf(world).filter((p) => p.album_id === own[0]!.id).length);
    const confirm = within(dialog).getByRole('button', { name: t.picker.confirm });
    expect(confirm).toHaveProperty('disabled', true);
    await user.click(radios[1]!);
    expect(confirm).toHaveProperty('disabled', false);
    await user.click(confirm);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const photo = photosOf(world).filter((p) => p.album_id === own[0]!.id)[1]!;
    expect(categoryRow(world, category.id).cover_photo_id).toBe(photo.id);
    expect(update).toHaveBeenCalledWith(category.id, { cover_photo_id: photo.id }, { expectedUpdatedAt: category.updated_at });
    expect(await screen.findByText(t.set)).toBeTruthy();
    await waitFor(() => expect(within(block()).getByRole('button', { name: t.change })).toBeTruthy());
  });

  it('arrow keys move the choice between the photos', async () => {
    const user = userEvent.setup();
    const { world, category } = await setup();
    await openCategory(world, category);
    const dialog = await openPicker(user);
    const radios = photoRadios(dialog);
    await user.click(radios[0]!);
    await user.keyboard('{ArrowRight}');
    expect(radios[1]!.checked).toBe(true);
    expect(document.activeElement).toBe(radios[1]);
  });

  it('cancel closes without a write and focus returns to the trigger', async () => {
    const user = userEvent.setup();
    const { world, category } = await setup();
    const update = vi.spyOn(world.ports.catalog, 'updateCategory');
    await openCategory(world, category);
    const dialog = await openPicker(user);
    await user.click(photoRadios(dialog)[0]!);
    await user.click(within(dialog).getByRole('button', { name: cs.glossary.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(update).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(within(block()).getByRole('button', { name: t.choose }));
  });

  it('Escape closes it too', async () => {
    const user = userEvent.setup();
    const { world, category } = await setup();
    await openCategory(world, category);
    await openPicker(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a low-resolution photo can be chosen but shows the warning', async () => {
    const user = userEvent.setup();
    const { world, category, low, lowAlbum } = await setup();
    await openCategory(world, category);
    const dialog = await openPicker(user);
    await user.click(within(dialog).getByRole('radio', { name: lowAlbum.title }));
    const lowRadio = await waitFor(() => {
      const r = photoRadios(dialog).find((x) => x.value === low.id);
      expect(r).toBeTruthy();
      return r!;
    });
    expect(within(lowRadio.closest('label')!).getByText(cs.quality.verdict.low)).toBeTruthy();
    expect(within(dialog).queryByText(t.picker.lowWarning)).toBeNull();
    await user.click(lowRadio);
    expect(within(dialog).getByText(t.picker.lowWarning)).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: t.picker.confirm });
    expect(confirm).toHaveProperty('disabled', false);
    await user.click(confirm);
    await waitFor(() => expect(categoryRow(world, category.id).cover_photo_id).toBe(low.id));
  });

  it('switching the album clears the photo choice', async () => {
    const user = userEvent.setup();
    const { world, category, own } = await setup();
    expect(own.filter((a) => photosOf(world).some((p) => p.album_id === a.id)).length).toBeGreaterThan(1);
    await openCategory(world, category);
    const dialog = await openPicker(user);
    await user.click(photoRadios(dialog)[0]!);
    await user.click(within(dialog).getByRole('radio', { name: own[1]!.title }));
    await waitFor(() => expect(photoRadios(dialog).every((r) => !r.checked)).toBe(true));
    expect(within(dialog).getByRole('button', { name: t.picker.confirm })).toHaveProperty('disabled', true);
  });

  it('the chosen photo opens in its own album when the picker is opened again', async () => {
    const user = userEvent.setup();
    const { world, category, low, lowAlbum } = await setup();
    await world.ports.catalog.updateCategory(category.id, { cover_photo_id: low.id });
    await openCategory(world, categoryRow(world, category.id));
    const dialog = await openPicker(user);
    expect((within(dialog).getByRole('radio', { name: lowAlbum.title }) as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(photoRadios(dialog).find((r) => r.value === low.id)!.checked).toBe(true));
  });

  it('CATEGORY_COVER_NOT_IN_CATEGORY: says so in Czech and refreshes the lists', async () => {
    const user = userEvent.setup();
    const { world, category, own, otherAlbum } = await setup();
    await openCategory(world, category);
    const dialog = await openPicker(user);
    const radios = photoRadios(dialog);
    await user.click(radios[0]!);
    // The photo leaves the category behind the picker's back.
    await world.ports.catalog.updatePhoto(radios[0]!.value, { album_id: otherAlbum.id });
    await user.click(within(dialog).getByRole('button', { name: t.picker.confirm }));
    expect(await within(dialog).findByText('Fotka už není v této kategorii.')).toBeTruthy();
    expect(categoryRow(world, category.id).cover_photo_id).toBeNull();
    await waitFor(() => expect(photoRadios(dialog).some((r) => r.value === radios[0]!.value)).toBe(false));
    expect(own.length).toBeGreaterThan(0);
  });

  it('a stale category shows the reload notice', async () => {
    const user = userEvent.setup();
    const { world, category } = await setup();
    await openCategory(world, category);
    const dialog = await openPicker(user);
    await user.click(photoRadios(dialog)[0]!);
    await world.ports.catalog.updateCategory(category.id, { description: 'Změněno jinde' });
    await user.click(within(dialog).getByRole('button', { name: t.picker.confirm }));
    expect(await within(dialog).findByText(cs.data.staleSentenceBy.category)).toBeTruthy();
  });

  it('has no serious axe violations with the picker open', async () => {
    const user = userEvent.setup();
    const { world, category } = await setup();
    await openCategory(world, category);
    const dialog = await openPicker(user);
    await user.click(photoRadios(dialog)[0]!);
    const result = await axe.run(document.body, {
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  });
});

describe('clear and the cleared notice', () => {
  it('"Zrušit výběr" returns to automatic', async () => {
    const user = userEvent.setup();
    const { world, category, own } = await setup();
    const photo = photosOf(world).find((p) => p.album_id === own[0]!.id)!;
    await world.ports.catalog.updateCategory(category.id, { cover_photo_id: photo.id });
    await openCategory(world, categoryRow(world, category.id));
    await user.click(await within(block()).findByRole('button', { name: t.clear }));
    await waitFor(() => expect(within(block()).getByText(t.auto)).toBeTruthy());
    expect(categoryRow(world, category.id).cover_photo_id).toBeNull();
    expect(await screen.findByText(t.unset)).toBeTruthy();
    // Our own clearing is not reported as "the photo is no longer in the category".
    expect(screen.queryByText(t.cleared)).toBeNull();
  });

  it('a failed clearing keeps the choice and shows the error', async () => {
    const user = userEvent.setup();
    const { world, category, own } = await setup();
    const photo = photosOf(world).find((p) => p.album_id === own[0]!.id)!;
    await world.ports.catalog.updateCategory(category.id, { cover_photo_id: photo.id });
    await openCategory(world, categoryRow(world, category.id));
    world.failNext('catalog.updateCategory', 'network', 1);
    await user.click(await within(block()).findByRole('button', { name: t.clear }));
    expect(await within(block()).findByRole('alert')).toBeTruthy();
    expect(categoryRow(world, category.id).cover_photo_id).toBe(photo.id);
  });

  it('moving the album that holds the photo to another category clears the choice and says why', async () => {
    const user = userEvent.setup();
    const { world, category, own } = await setup();
    const holder = own.find((a) => photosOf(world).some((p) => p.album_id === a.id))!;
    const photo = photosOf(world).find((p) => p.album_id === holder.id)!;
    await world.ports.catalog.updateCategory(category.id, { cover_photo_id: photo.id });
    await openCategory(world, categoryRow(world, category.id));
    await within(block()).findByRole('button', { name: t.clear });
    await user.click(screen.getByRole('button', { name: `Přesunout do jiné kategorie: ${holder.title}` }));
    const dialog = await screen.findByRole('dialog', { name: `Přesunout album ${holder.title}` });
    await user.click(within(dialog).getByRole('button', { name: 'Přesunout' }));
    expect(await within(block()).findByText(t.cleared)).toBeTruthy();
    expect(categoryRow(world, category.id).cover_photo_id).toBeNull();
    expect(within(block()).getByText(t.auto)).toBeTruthy();
    await user.click(within(block()).getByRole('button', { name: t.dismiss }));
    expect(within(block()).queryByText(t.cleared)).toBeNull();
  });

  it('shows the notice that another screen left behind, once', async () => {
    const { world, category } = await setup();
    markCategoryCoverCleared(category.id);
    const view = await openCategory(world, category);
    expect(await within(block()).findByText(t.cleared)).toBeTruthy();
    view.unmount();
    cleanup();
    await openCategory(world, category);
    await ready();
    expect(within(block()).queryByText(t.cleared)).toBeNull();
  });
});

describe('what the photo screens leave behind', () => {
  function Actions({ onReady }: { onReady: (api: { actions: ReturnType<typeof usePhotoActions>; deleter: ReturnType<typeof usePhotoDeleter> }) => void }) {
    const actions = usePhotoActions();
    const deleter = usePhotoDeleter();
    onReady({ actions, deleter });
    return null;
  }

  async function withActions(world: FakeWorld, path: string) {
    let api!: { actions: ReturnType<typeof usePhotoActions>; deleter: ReturnType<typeof usePhotoDeleter> };
    mount(world, path, <Actions onReady={(a) => (api = a)} />);
    await waitFor(() => expect(api).toBeTruthy());
    return () => api;
  }

  it('moving the main photo to an album of another category clears it and marks the notice', async () => {
    const { world, category, own, otherAlbum } = await setup();
    const album = own.find((a) => photosOf(world).some((p) => p.album_id === a.id))!;
    const photo = photosOf(world).find((p) => p.album_id === album.id)!;
    await world.ports.catalog.updateCategory(category.id, { cover_photo_id: photo.id });
    const api = await withActions(world, '/');
    await api().actions.movePhotos(album, otherAlbum.id, [photo.id]);
    expect(categoryRow(world, category.id).cover_photo_id).toBeNull();
    expect(takeCategoryCoverCleared(category.id)).toBe(true);
  });

  it('moving it within the category keeps the choice and marks nothing', async () => {
    const { world, category, own } = await setup();
    const albums = own.filter((a) => photosOf(world).some((p) => p.album_id === a.id));
    expect(albums.length).toBeGreaterThan(1);
    const photo = photosOf(world).find((p) => p.album_id === albums[0]!.id)!;
    await world.ports.catalog.updateCategory(category.id, { cover_photo_id: photo.id });
    const api = await withActions(world, '/');
    await api().actions.movePhotos(albums[0]!, albums[1]!.id, [photo.id]);
    expect(categoryRow(world, category.id).cover_photo_id).toBe(photo.id);
    expect(takeCategoryCoverCleared(category.id)).toBe(false);
  });

  it('moving another photo marks nothing', async () => {
    const { world, category, own, otherAlbum } = await setup();
    const album = own.find((a) => photosOf(world).filter((p) => p.album_id === a.id).length >= 2)!;
    const [first, second] = photosOf(world).filter((p) => p.album_id === album.id);
    await world.ports.catalog.updateCategory(category.id, { cover_photo_id: first!.id });
    const api = await withActions(world, '/');
    await api().actions.movePhotos(album, otherAlbum.id, [second!.id]);
    expect(categoryRow(world, category.id).cover_photo_id).toBe(first!.id);
    expect(takeCategoryCoverCleared(category.id)).toBe(false);
  });

  it('deleting the main photo clears it and marks the notice', async () => {
    const { world, category, own } = await setup();
    const album = own.find((a) => photosOf(world).some((p) => p.album_id === a.id))!;
    const photo = photosOf(world).find((p) => p.album_id === album.id)!;
    await world.ports.catalog.updateCategory(category.id, { cover_photo_id: photo.id });
    const api = await withActions(world, '/');
    const outcome = await api().deleter.deletePhotos(album, [photo]);
    expect(outcome.removedIds).toEqual([photo.id]);
    expect(categoryRow(world, category.id).cover_photo_id).toBeNull();
    expect(takeCategoryCoverCleared(category.id)).toBe(true);
  });

  it('deleting another photo marks nothing', async () => {
    const { world, category, own } = await setup();
    const album = own.find((a) => photosOf(world).filter((p) => p.album_id === a.id).length >= 2)!;
    const [first, second] = photosOf(world).filter((p) => p.album_id === album.id);
    await world.ports.catalog.updateCategory(category.id, { cover_photo_id: first!.id });
    const api = await withActions(world, '/');
    await api().deleter.deletePhotos(album, [second!]);
    expect(categoryRow(world, category.id).cover_photo_id).toBe(first!.id);
    expect(takeCategoryCoverCleared(category.id)).toBe(false);
  });
});

describe('badge in the album grid', () => {
  it('marks only the main photo of the category', async () => {
    const { world, category, own } = await setup();
    const album = own.find((a) => photosOf(world).some((p) => p.album_id === a.id))!;
    const photo = photosOf(world).find((p) => p.album_id === album.id)!;
    await world.ports.catalog.updateCategory(category.id, { cover_photo_id: photo.id });
    mount(world, `/alba/${album.id}`);
    await screen.findByRole('list', { name: cs.photos.gridLabel });
    const badges = await screen.findAllByText(t.heading);
    expect(badges).toHaveLength(1);
    expect(badges[0]!.closest('li')!.getAttribute('data-photo-id')).toBe(photo.id);
  });

  it('shows no badge when the category has no main photo', async () => {
    const { world, own } = await setup();
    const album = own.find((a) => photosOf(world).some((p) => p.album_id === a.id))!;
    mount(world, `/alba/${album.id}`);
    await screen.findByRole('list', { name: cs.photos.gridLabel });
    expect(screen.queryByText(t.heading)).toBeNull();
  });
});
