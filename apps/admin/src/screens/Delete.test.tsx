import axe from 'axe-core';
import type { AlbumRow, PhotoRow } from '@mp/shared';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorld, fixtureSnapshot, type FakeWorld } from '../adapters/fake';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { chunkIds, DELETE_CHUNK, usePhotoDeleter } from '../data/deleteActions';
import { cs } from '../i18n/cs';
import { fill, formatBytes } from '../i18n/format';
import { ApiError } from '../ports';
import { confirmsAlbumDelete } from './DeleteDialogs';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const albumsOf = (world: FakeWorld) => world.snapshot().albums as AlbumRow[];
const allPhotos = (world: FakeWorld) => world.snapshot().photos as PhotoRow[];
const photosOf = (world: FakeWorld, albumId: string) => allPhotos(world).filter((p) => p.album_id === albumId);
const dbAlbum = (world: FakeWorld, id: string) => albumsOf(world).find((a) => a.id === id);

function setup(min = 6) {
  const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
  const count = (a: AlbumRow) => photosOf(world, a.id).length;
  const album = albumsOf(world)
    .filter((a) => count(a) >= min)
    .sort((a, b) => count(a) - count(b))[0]!;
  return { world, album };
}

function renderAt(world: FakeWorld, path: string) {
  return render(
    <AppProviders ports={world.ports} retry={false} imgBaseUrl="https://img.test">
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AppProviders>,
  );
}

async function openAlbum(world: FakeWorld, album: AlbumRow) {
  renderAt(world, `/alba/${album.id}`);
  await screen.findByRole('heading', { level: 1, name: album.title });
  await screen.findByRole('list', { name: cs.photos.gridLabel });
}

const tiles = () => within(screen.getByRole('list', { name: cs.photos.gridLabel })).getAllByRole('listitem');
const tileOf = (id: string) => tiles().find((li) => li.getAttribute('data-photo-id') === id)!;
const storageText = () => document.querySelector('.storage-mini .storage-line')!.textContent;

describe('chunks of 200', () => {
  it('splits 450 ids into 200, 200 and 50', () => {
    expect(DELETE_CHUNK).toBe(200);
    expect(chunkIds(Array.from({ length: 450 }, (_, i) => i)).map((c) => c.length)).toEqual([200, 200, 50]);
    expect(chunkIds([])).toEqual([]);
  });

  it('sends 450 photos as three requests in order and sums the freed bytes', async () => {
    const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
    const rows = Array.from({ length: 450 }, (_, i) => ({ id: `id-${i}`, bytes_total: 10 }));
    const spy = vi.spyOn(world.ports.api, 'deletePhotos').mockImplementation(async ({ ids }) => ({
      deleted: ids.length,
      objectsDeleted: ids.length,
      failed: [],
      publishRecommended: true,
    }));
    let outcome: Awaited<ReturnType<ReturnType<typeof usePhotoDeleter>['deleteRows']>> | undefined;
    function Harness() {
      const deleter = usePhotoDeleter();
      return (
        <button
          type="button"
          onClick={() =>
            void deleter.deleteRows(rows).then((r) => {
              outcome = r;
            })
          }
        >
          go
        </button>
      );
    }
    render(
      <AppProviders ports={world.ports} retry={false}>
        <MemoryRouter>
          <Harness />
        </MemoryRouter>
      </AppProviders>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'go' }));
    await waitFor(() => expect(outcome).toBeDefined());
    expect(spy.mock.calls.map((c) => c[0].ids.length)).toEqual([200, 200, 50]);
    expect(outcome!.removedIds).toHaveLength(450);
    expect(outcome!.freedBytes).toBe(4500);
    expect(outcome!.failedIds).toEqual([]);
  });

  it('stops at the first chunk that throws and reports it and the rest as failed', async () => {
    const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
    const rows = Array.from({ length: 450 }, (_, i) => ({ id: `id-${i}`, bytes_total: 1 }));
    const spy = vi
      .spyOn(world.ports.api, 'deletePhotos')
      .mockResolvedValueOnce({ deleted: 200, objectsDeleted: 200, failed: [], publishRecommended: true })
      .mockRejectedValueOnce(new ApiError('INTERNAL'));
    let outcome: Awaited<ReturnType<ReturnType<typeof usePhotoDeleter>['deleteRows']>> | undefined;
    function Harness() {
      const deleter = usePhotoDeleter();
      return (
        <button type="button" onClick={() => void deleter.deleteRows(rows).then((r) => (outcome = r))}>
          go
        </button>
      );
    }
    render(
      <AppProviders ports={world.ports} retry={false}>
        <MemoryRouter>
          <Harness />
        </MemoryRouter>
      </AppProviders>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'go' }));
    await waitFor(() => expect(outcome).toBeDefined());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(outcome!.removedIds).toHaveLength(200);
    expect(outcome!.failedIds).toHaveLength(250);
    expect(outcome!.error).toBeInstanceOf(ApiError);
  });
});

describe('delete photos', () => {
  it('bulk: exact dialog text, toast with freed size, storage bar lowers, publish dot appears', async () => {
    const user = userEvent.setup();
    const { world, album } = setup();
    const rows = photosOf(world, album.id);
    const doomed = rows.slice(0, 5);
    const freed = doomed.reduce((sum, p) => sum + p.bytes_total, 0);
    await openAlbum(world, album);
    await waitFor(() => expect(storageText()).toContain('Úložiště'));
    const before = await world.ports.api.getStorage();
    expect(screen.queryByText(cs.publishIndicator.pending)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Vybrat' }));
    for (const n of [1, 2, 3, 4, 5]) await user.click(screen.getByRole('checkbox', { name: `Vybrat fotku ${n}` }));
    const deleteButton = screen.getByRole('button', { name: 'Smazat vybrané (5)' });
    await user.click(deleteButton);

    const dialog = await screen.findByRole('dialog', { name: 'Smazat 5 fotek?' });
    expect(within(dialog).getByText('Fotky se nenávratně smažou z úložiště a nelze je vrátit.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Smazat' }));

    expect(await screen.findByText(`Smazáno 5 fotek. Uvolněno ${formatBytes(freed)}.`)).toBeTruthy();
    expect(photosOf(world, album.id)).toHaveLength(rows.length - 5);
    await waitFor(() => expect(tiles()).toHaveLength(rows.length - 5));
    expect(screen.queryByRole('region', { name: cs.photos.selectionBar })).toBeNull();
    const after = await world.ports.api.getStorage();
    expect(after.used_bytes).toBe(before.used_bytes - freed);
    await waitFor(() => expect(storageText()).toContain(formatBytes(after.used_bytes)));
    expect((await screen.findAllByText(cs.publishIndicator.pending)).length).toBeGreaterThan(0);
  });

  it('single photo from the tile menu: "Smazat fotku" with the singular text', async () => {
    const user = userEvent.setup();
    const { world, album } = setup();
    const rows = photosOf(world, album.id);
    await openAlbum(world, album);
    await user.click(screen.getByRole('button', { name: fill(cs.photos.menu, { n: 2 }) }));
    await user.click(await screen.findByRole('button', { name: 'Smazat fotku' }));
    const dialog = await screen.findByRole('dialog', { name: 'Smazat fotku?' });
    expect(within(dialog).getByText('Fotka se nenávratně smaže z úložiště a nelze ji vrátit.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Zrušit' }));
    expect(photosOf(world, album.id)).toHaveLength(rows.length);
    await user.click(screen.getByRole('button', { name: fill(cs.photos.menu, { n: 2 }) }));
    await user.click(await screen.findByRole('button', { name: 'Smazat fotku' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Smazat fotku?' })).getByRole('button', { name: 'Smazat' }));
    expect(await screen.findByText(/^Smazána 1 fotka\. Uvolněno /)).toBeTruthy();
    expect(photosOf(world, album.id).some((p) => p.id === rows[1]!.id)).toBe(false);
  });

  it('a non-empty failed list says so, marks the tile "Mazání selhalo" and retries', async () => {
    const user = userEvent.setup();
    const { world, album } = setup();
    const rows = photosOf(world, album.id);
    const victim = rows[0]!;
    vi.spyOn(world.ports.api, 'deletePhotos').mockResolvedValueOnce({
      deleted: 0,
      objectsDeleted: 0,
      failed: [victim.id],
      publishRecommended: true,
    });
    await openAlbum(world, album);
    await user.click(screen.getByRole('button', { name: fill(cs.photos.menu, { n: 1 }) }));
    await user.click(await screen.findByRole('button', { name: 'Smazat fotku' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Smazat' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Smazání se nepodařilo dokončit.');
    expect(within(tileOf(victim.id)).getByText('Mazání selhalo')).toBeTruthy();
    expect(screen.queryByText(/^Smazáno |^Smazána |^Smazány /)).toBeNull();

    await user.click(within(alert).getByRole('button', { name: 'Zkusit znovu' }));
    await waitFor(() => expect(photosOf(world, album.id).some((p) => p.id === victim.id)).toBe(false));
    await waitFor(() => expect(screen.queryByText('Mazání selhalo')).toBeNull());
  });

  it('a deleted cover is replaced by the first remaining photo, with a toast', async () => {
    const user = userEvent.setup();
    const { world, album } = setup();
    const rows = photosOf(world, album.id);
    await world.ports.catalog.updateAlbum(album.id, { cover_photo_id: rows[0]!.id });
    await openAlbum(world, album);
    await user.click(screen.getByRole('button', { name: fill(cs.photos.menu, { n: 1 }) }));
    await user.click(await screen.findByRole('button', { name: 'Smazat fotku' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Smazat' }));
    expect(await screen.findByText(cs.photos.coverReassigned)).toBeTruthy();
    await waitFor(() => expect(dbAlbum(world, album.id)!.cover_photo_id).toBe(rows[1]!.id));
    await waitFor(() => expect(tileOf(rows[1]!.id).textContent).toContain('Titulní'));
  });

  it('has no serious axe violations in the delete dialog', async () => {
    const user = userEvent.setup();
    const { world, album } = setup();
    await openAlbum(world, album);
    await user.click(screen.getByRole('button', { name: 'Vybrat' }));
    await user.click(screen.getByRole('checkbox', { name: 'Vybrat fotku 1' }));
    await user.click(screen.getByRole('button', { name: 'Smazat vybrané (1)' }));
    await screen.findByRole('dialog');
    const result = await axe.run(document.body, {
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });
});

describe('delete album', () => {
  it('confirms only with the exact title or SMAZAT', () => {
    expect(confirmsAlbumDelete('Novákovi', 'Novákovi')).toBe(true);
    expect(confirmsAlbumDelete('SMAZAT', 'Novákovi')).toBe(true);
    expect(confirmsAlbumDelete('smazat', 'Novákovi')).toBe(false);
    expect(confirmsAlbumDelete('Novák', 'Novákovi')).toBe(false);
    expect(confirmsAlbumDelete('', '')).toBe(false);
  });

  it('deletes photos first, then the row, and goes to the category; storage lowers', async () => {
    const user = userEvent.setup();
    const { world, album } = setup();
    const n = photosOf(world, album.id).length;
    const order: string[] = [];
    const delPhotos = world.ports.api.deletePhotos.bind(world.ports.api);
    vi.spyOn(world.ports.api, 'deletePhotos').mockImplementation(async (r) => {
      order.push('photos');
      return delPhotos(r);
    });
    const delAlbum = world.ports.catalog.deleteAlbum.bind(world.ports.catalog);
    vi.spyOn(world.ports.catalog, 'deleteAlbum').mockImplementation(async (id) => {
      order.push('album');
      return delAlbum(id);
    });
    await openAlbum(world, album);
    await user.click(screen.getByRole('button', { name: 'Smazat album' }));
    const dialog = await screen.findByRole('dialog', {
      name: `Smazat album ${album.title} a všech ${n} fotek? Tuto akci nelze vrátit.`,
    });
    const confirm = within(dialog).getByRole('button', { name: 'Smazat album' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(within(dialog).getByLabelText(cs.delete.albumConfirmLabel), 'nesprávně');
    expect(confirm.disabled).toBe(true);
    await user.clear(within(dialog).getByLabelText(cs.delete.albumConfirmLabel));
    await user.type(within(dialog).getByLabelText(cs.delete.albumConfirmLabel), 'SMAZAT');
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);

    await waitFor(() => expect(dbAlbum(world, album.id)).toBeUndefined());
    expect(order).toEqual(['photos', 'album']);
    expect(photosOf(world, album.id)).toHaveLength(0);
    expect(await screen.findByText(/^Album smazáno\. Uvolněno /)).toBeTruthy();
    await screen.findByRole('heading', { level: 1, name: (await world.ports.catalog.getCategory(album.category_id))!.name });
  });

  it('the typed album title also confirms', async () => {
    const user = userEvent.setup();
    const { world, album } = setup();
    await openAlbum(world, album);
    await user.click(screen.getByRole('button', { name: 'Smazat album' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(cs.delete.albumConfirmLabel), album.title);
    await user.click(within(dialog).getByRole('button', { name: 'Smazat album' }));
    await waitFor(() => expect(dbAlbum(world, album.id)).toBeUndefined());
  });

  it('a failed chunk keeps the album, says so and offers "Skrýt album"', async () => {
    const user = userEvent.setup();
    const { world, album } = setup();
    await world.ports.catalog.updateAlbum(album.id, { published: true });
    const deleteRow = vi.spyOn(world.ports.catalog, 'deleteAlbum');
    await openAlbum(world, album);
    world.failNext('api.deletePhotos', new ApiError('INTERNAL'));
    await user.click(screen.getByRole('button', { name: 'Smazat album' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(cs.delete.albumConfirmLabel), 'SMAZAT');
    await user.click(within(dialog).getByRole('button', { name: 'Smazat album' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('Smazání se nepodařilo dokončit.');
    expect(deleteRow).not.toHaveBeenCalled();
    expect(dbAlbum(world, album.id)).toBeDefined();

    await user.click(within(dialog).getByRole('button', { name: 'Skrýt album' }));
    await waitFor(() => expect(dbAlbum(world, album.id)!.published).toBe(false));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('retry after a failure deletes the album once the photos are gone', async () => {
    const user = userEvent.setup();
    const { world, album } = setup();
    await openAlbum(world, album);
    world.failNext('api.deletePhotos', new ApiError('INTERNAL'));
    await user.click(screen.getByRole('button', { name: 'Smazat album' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(cs.delete.albumConfirmLabel), 'SMAZAT');
    await user.click(within(dialog).getByRole('button', { name: 'Smazat album' }));
    await within(dialog).findByRole('alert');
    await user.click(within(dialog).getByRole('button', { name: 'Zkusit znovu' }));
    await waitFor(() => expect(dbAlbum(world, album.id)).toBeUndefined());
  });

  it('also works from the album row of the category screen', async () => {
    const user = userEvent.setup();
    const { world, album } = setup();
    renderAt(world, `/kategorie/${album.category_id}`);
    await screen.findByRole('list', { name: cs.categoryDetail.listLabel });
    const button = await screen.findByRole('button', { name: `Smazat album: ${album.title}` });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    await user.click(button);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(cs.delete.albumConfirmLabel), 'SMAZAT');
    await user.click(within(dialog).getByRole('button', { name: 'Smazat album' }));
    await waitFor(() => expect(dbAlbum(world, album.id)).toBeUndefined());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('delete category', () => {
  it('a category with albums shows the sentence and sends no delete request', async () => {
    const user = userEvent.setup();
    const { world, album } = setup();
    const spy = vi.spyOn(world.ports.catalog, 'deleteCategory');
    const inCategory = albumsOf(world).filter((a) => a.category_id === album.category_id).length;
    renderAt(world, `/kategorie/${album.category_id}`);
    await waitFor(async () => expect((await screen.findByRole('button', { name: 'Smazat kategorii' })) as HTMLButtonElement).toHaveProperty('disabled', false));
    await user.click(screen.getByRole('button', { name: 'Smazat kategorii' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(
      `Kategorie obsahuje ${inCategory} ${inCategory === 1 ? 'album' : inCategory < 5 ? 'alba' : 'alb'}. Nejdřív album přesuňte nebo smažte, nebo kategorii skryjte.`,
    );
    expect(within(dialog).queryByRole('button', { name: 'Smazat' })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('an empty category is deleted after a plain confirmation and the screen goes back', async () => {
    const user = userEvent.setup();
    const { world, album } = setup();
    const empty = await world.ports.catalog.createCategory({
      slug: 'prazdna',
      name: 'Prázdná',
      description: null,
      seo_title: null,
      seo_description: null,
      sort: 99_000,
      visible: true,
    });
    expect(album.category_id).not.toBe(empty.id);
    renderAt(world, `/kategorie/${empty.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Prázdná' });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Smazat kategorii' }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: 'Smazat kategorii' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Smazat' }));
    await waitFor(() => expect((world.snapshot().categories as { id: string }[]).some((c) => c.id === empty.id)).toBe(false));
    await screen.findByRole('heading', { level: 1, name: cs.routes.categories.title });
  });
});
