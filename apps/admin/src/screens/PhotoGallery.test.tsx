import axe from 'axe-core';
import { webpKey, type AlbumRow, type PhotoRow } from '@mp/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorld, fixtureSnapshot, type FakeWorld } from '../adapters/fake';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { LONG_PRESS_MS } from '../components/PhotoGrid';
import { planDragEnd } from '../components/SortableList';
import { cs } from '../i18n/cs';
import { fill, plural } from '../i18n/format';
import { ApiError } from '../ports';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const IMG = 'https://img.test';
const albumsOf = (world: FakeWorld) => world.snapshot().albums as AlbumRow[];
const photosOf = (world: FakeWorld, albumId: string) =>
  (world.snapshot().photos as PhotoRow[]).filter((p) => p.album_id === albumId);
const dbAlbum = (world: FakeWorld, id: string) => albumsOf(world).find((a) => a.id === id)!;

/** The fixture catalog; `album` is the smallest album with at least `min` photos. */
function setup(min = 6) {
  const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
  const all = world.snapshot().photos as PhotoRow[];
  const count = (a: AlbumRow) => all.filter((p) => p.album_id === a.id).length;
  const album = albumsOf(world)
    .filter((a) => count(a) >= min)
    .sort((a, b) => count(a) - count(b))[0]!;
  const other = albumsOf(world).find((a) => a.id !== album.id && count(a) > 0)!;
  return { world, album, other };
}

/** Gives every photo of the album an alt text (the fixture has none). */
async function withAlt(world: FakeWorld, albumId: string) {
  for (const p of photosOf(world, albumId)) await world.ports.catalog.updatePhoto(p.id, { alt: `Popis fotky ${p.sort}` });
}

async function open(world: FakeWorld, album: AlbumRow) {
  const view = render(
    <AppProviders ports={world.ports} retry={false} imgBaseUrl={IMG}>
      <MemoryRouter initialEntries={[`/alba/${album.id}`]}>
        <App />
      </MemoryRouter>
    </AppProviders>,
  );
  await screen.findByRole('heading', { level: 1, name: album.title });
  await screen.findByRole('list', { name: cs.photos.gridLabel });
  return view;
}

const grid = () => screen.getByRole('list', { name: cs.photos.gridLabel });
const tiles = () => within(grid()).getAllByRole('listitem');
const tileOf = (id: string) => tiles().find((li) => li.getAttribute('data-photo-id') === id)!;
const orderInDb = (world: FakeWorld, albumId: string) => photosOf(world, albumId).map((p) => p.id);

async function openMenu(user: ReturnType<typeof userEvent.setup>, position: number) {
  await user.click(screen.getByRole('button', { name: fill(cs.photos.menu, { n: position }) }));
  return screen.findByRole('dialog', { name: fill(cs.photos.menuTitle, { n: position }) });
}

describe('grid tiles', () => {
  it('shows the 480 WebP from the key helper with size, alt, placeholder colour, cover badge and alt dot', async () => {
    const { world, album } = setup();
    await withAlt(world, album.id);
    const rows = photosOf(world, album.id);
    await world.ports.catalog.updatePhoto(rows[1]!.id, { alt: null });
    await world.ports.catalog.updatePhoto(rows[2]!.id, { alt: '   ' });
    await world.ports.catalog.updateAlbum(album.id, { cover_photo_id: rows[3]!.id });
    await open(world, album);
    const fresh = photosOf(world, album.id);
    expect(tiles()).toHaveLength(fresh.length);
    for (const photo of fresh) {
      const img = tileOf(photo.id).querySelector('img')!;
      expect(img.getAttribute('src')).toBe(`${IMG}/${webpKey(photo.id, 480)}`);
      expect(img.getAttribute('width')).toBe('480');
      expect(Number(img.getAttribute('height'))).toBeGreaterThan(0);
      expect(img.getAttribute('alt')).toBeTruthy();
      expect(img.getAttribute('loading')).toBe('lazy');
      if (photo.dominant_color) {
        expect((tileOf(photo.id).querySelector('.photo-frame') as HTMLElement).style.backgroundColor).not.toBe('');
      }
    }
    const badges = screen.getAllByText('Titulní');
    expect(badges).toHaveLength(1);
    expect(tileOf(rows[3]!.id).contains(badges[0]!)).toBe(true);
    const dots = within(grid()).getAllByRole('img', { name: cs.photos.altMissingDot });
    expect(dots).toHaveLength(2);
    expect(tileOf(rows[1]!.id).querySelector('.photo-dot')).not.toBeNull();
    expect(tileOf(rows[0]!.id).querySelector('.photo-dot')).toBeNull();
  });

  it('names a photo without alt text "Fotka N" in the image alt', async () => {
    const { world, album } = setup();
    const rows = photosOf(world, album.id);
    await world.ports.catalog.updatePhoto(rows[0]!.id, { alt: null });
    await open(world, album);
    expect(tileOf(rows[0]!.id).querySelector('img')!.getAttribute('alt')).toBe('Fotka 1');
  });

  it('links each tile to its detail', async () => {
    const { world, album } = setup();
    await open(world, album);
    const first = photosOf(world, album.id)[0]!;
    expect(tileOf(first.id).querySelector('a')!.getAttribute('href')).toBe(`/alba/${album.id}/foto/${first.id}`);
  });
});

describe('missing alt filter', () => {
  it('counts photos without alt text and shows only them while pressed', async () => {
    const user = userEvent.setup();
    const { world, album } = setup();
    await withAlt(world, album.id);
    const rows = photosOf(world, album.id);
    for (const r of rows.slice(0, 3)) await world.ports.catalog.updatePhoto(r.id, { alt: null });
    await open(world, album);
    const button = screen.getByRole('button', { name: '3 fotky nemají alternativní text' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    await user.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(tiles().map((li) => li.getAttribute('data-photo-id'))).toEqual(rows.slice(0, 3).map((r) => r.id));
    await user.click(button);
    expect(tiles()).toHaveLength(rows.length);
  });

  it('has the Czech forms for 1, 4 and 12', () => {
    const text = (n: number) => fill(plural(n, cs.photos.missingAlt), { count: n });
    expect(text(1)).toBe('1 fotka nemá alternativní text');
    expect(text(4)).toBe('4 fotky nemají alternativní text');
    expect(text(12)).toBe('12 fotek nemá alternativní text');
  });

  it('is absent when every photo has alt text', async () => {
    const { world, album } = setup();
    for (const r of photosOf(world, album.id)) await world.ports.catalog.updatePhoto(r.id, { alt: 'Popis fotky' });
    await open(world, album);
    expect(screen.queryByRole('button', { name: /alternativní text/ })).toBeNull();
  });
});

describe('cover', () => {
  it('"Nastavit jako titulní" moves the badge and says so', async () => {
    const user = userEvent.setup();
    const { world, album } = setup();
    const rows = photosOf(world, album.id);
    await open(world, album);
    const menu = await openMenu(user, 3);
    await user.click(within(menu).getByRole('button', { name: 'Nastavit jako titulní' }));
    expect(await screen.findByText('Titulní fotka nastavena.')).toBeTruthy();
    await waitFor(() => expect(dbAlbum(world, album.id).cover_photo_id).toBe(rows[2]!.id));
    await waitFor(() => expect(tileOf(rows[2]!.id).textContent).toContain('Titulní'));
    expect(screen.getAllByText('Titulní')).toHaveLength(1);
  });

  it('a cover tile has no "Nastavit jako titulní" in its menu', async () => {
    const user = userEvent.setup();
    const { world, album } = setup();
    const rows = photosOf(world, album.id);
    await world.ports.catalog.updateAlbum(album.id, { cover_photo_id: rows[0]!.id });
    await open(world, album);
    const menu = await openMenu(user, 1);
    expect(within(menu).queryByRole('button', { name: 'Nastavit jako titulní' })).toBeNull();
  });
});

describe('reordering without dragging', () => {
  it('"Posunout na konec" and "Posunout na začátek" write only sort', async () => {
    const user = userEvent.setup();
    const { world, album } = setup();
    const before = orderInDb(world, album.id);
    const update = vi.spyOn(world.ports.catalog, 'updatePhoto');
    await open(world, album);
    await user.click(within(await openMenu(user, 2)).getByRole('button', { name: cs.photos.moveToEnd }));
    await waitFor(() => expect(orderInDb(world, album.id)).toEqual([before[0], ...before.slice(2), before[1]]));
    expect(await screen.findByText('Pořadí uloženo')).toBeTruthy();
    for (const call of update.mock.calls) expect(Object.keys(call[1])).toEqual(['sort']);
    await user.click(within(await openMenu(user, before.length)).getByRole('button', { name: cs.photos.moveToStart }));
    await waitFor(() => expect(orderInDb(world, album.id)[0]).toBe(before[1]));
  });

  it('"Přesunout do pozice…" moves to the typed position and refuses a bad one', async () => {
    const user = userEvent.setup();
    const { world, album } = setup();
    const before = orderInDb(world, album.id);
    await open(world, album);
    const menu = await openMenu(user, 1);
    await user.click(within(menu).getByRole('button', { name: cs.reorder.moveToPosition }));
    const input = within(menu).getByLabelText(fill(cs.reorder.positionLabel, { max: before.length }));
    await user.clear(input);
    await user.type(input, '99');
    await user.click(within(menu).getByRole('button', { name: cs.reorder.positionSubmit }));
    expect(within(menu).getByText(fill(cs.reorder.positionInvalid, { max: before.length }))).toBeTruthy();
    await user.clear(input);
    await user.type(input, '3');
    await user.click(within(menu).getByRole('button', { name: cs.reorder.positionSubmit }));
    await waitFor(() => expect(orderInDb(world, album.id).indexOf(before[0]!)).toBe(2));
  });

  it('the first photo cannot move to the start, the last not to the end', async () => {
    const user = userEvent.setup();
    const { world, album } = setup();
    const total = photosOf(world, album.id).length;
    await open(world, album);
    const first = await openMenu(user, 1);
    expect((within(first).getByRole('button', { name: cs.photos.moveToStart }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(first).getByRole('button', { name: cs.photos.close }));
    const last = await openMenu(user, total);
    expect((within(last).getByRole('button', { name: cs.photos.moveToEnd }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a failed save restores the order and "Zkusit znovu" saves it', async () => {
    const user = userEvent.setup();
    const { world, album } = setup();
    const before = orderInDb(world, album.id);
    await open(world, album);
    world.failNext('catalog.updatePhoto', new ApiError('INTERNAL'));
    await user.click(within(await openMenu(user, 1)).getByRole('button', { name: cs.photos.moveToEnd }));
    const alert = await screen.findByText(cs.reorder.failed);
    expect(orderInDb(world, album.id)).toEqual(before);
    expect(tiles().map((li) => li.getAttribute('data-photo-id'))).toEqual(before);
    await user.click(within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Zkusit znovu' }));
    await waitFor(() => expect(orderInDb(world, album.id).at(-1)).toBe(before[0]));
  });

  it('dropping a tile on another plans the same moves as the buttons', () => {
    const rows = [
      { id: 'a', sort: 10 },
      { id: 'b', sort: 20 },
      { id: 'c', sort: 30 },
      { id: 'd', sort: 40 },
    ];
    expect(planDragEnd(rows, 'a', 'c')).toEqual([{ id: 'a', sort: 35 }]);
    expect(planDragEnd(rows, 'a', 'a')).toEqual([]);
  });

  it('every tile has a drag handle that works with the keyboard sensor', async () => {
    const { world, album } = setup();
    await open(world, album);
    const handle = screen.getByRole('button', { name: fill(cs.photos.handle, { n: 1 }) });
    expect(handle.getAttribute('aria-roledescription')).toBe(cs.reorder.roleDescription);
    expect(handle.getAttribute('tabindex')).toBe('0');
  });
});

describe('selection mode', () => {
  it('"Vybrat" shows checkboxes, "Vybráno N" counts, "Zrušit výběr" clears', async () => {
    const user = userEvent.setup();
    const { world, album } = setup();
    await open(world, album);
    expect(screen.queryByRole('checkbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Vybrat' }));
    await user.click(screen.getByRole('checkbox', { name: 'Vybrat fotku 1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Vybrat fotku 2' }));
    const bar = screen.getByRole('region', { name: cs.photos.selectionBar });
    expect(within(bar).getByText('Vybráno 2')).toBeTruthy();
    await user.click(within(bar).getByRole('button', { name: 'Zrušit výběr' }));
    expect(screen.queryByRole('region', { name: cs.photos.selectionBar })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('a long press on a tile starts selection with that tile and does not open the photo', async () => {
    const { world, album } = setup();
    await open(world, album);
    const first = photosOf(world, album.id)[0]!;
    const frame = tileOf(first.id).querySelector('.photo-frame')!;
    fireEvent.pointerDown(frame, { clientX: 5, clientY: 5 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 100));
    });
    expect(screen.getByText('Vybráno 1')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Vybrat fotku 1' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(tileOf(first.id).querySelector('a')!);
    expect(screen.getByText('Vybráno 1')).toBeTruthy();
  });

  it('a short press selects nothing', async () => {
    const { world, album } = setup();
    await open(world, album);
    const frame = tileOf(photosOf(world, album.id)[0]!.id).querySelector('.photo-frame')!;
    fireEvent.pointerDown(frame, { clientX: 5, clientY: 5 });
    fireEvent.pointerUp(frame);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 100));
    });
    expect(screen.queryByText(/Vybráno/)).toBeNull();
  });
});

describe('move to another album', () => {
  it('moving 5 photos appends them in order, clears the selection and reassigns the source cover', async () => {
    const user = userEvent.setup();
    const { world, album, other } = setup(7);
    const rows = photosOf(world, album.id);
    const targetBefore = photosOf(world, other.id);
    await world.ports.catalog.updateAlbum(album.id, { cover_photo_id: rows[1]!.id });
    const update = vi.spyOn(world.ports.catalog, 'updatePhoto');
    await open(world, album);

    await user.click(screen.getByRole('button', { name: 'Vybrat' }));
    // Selected out of order on purpose: the target keeps the album order, not the click order.
    for (const n of [5, 2, 4, 1, 3]) await user.click(screen.getByRole('checkbox', { name: `Vybrat fotku ${n}` }));
    const bar = screen.getByRole('region', { name: cs.photos.selectionBar });
    expect(within(bar).getByText('Vybráno 5')).toBeTruthy();
    await user.click(within(bar).getByRole('button', { name: 'Přesunout do alba' }));

    const dialog = await screen.findByRole('dialog', { name: 'Přesunout do alba' });
    expect(within(dialog).queryByText(album.title, { selector: 'span' })).toBeNull();
    await user.type(within(dialog).getByLabelText(cs.photos.searchAlbums), other.title.slice(0, 4));
    const radio = within(dialog)
      .getAllByRole('radio')
      .find((r) => (r as HTMLInputElement).value === other.id)!;
    await user.click(radio);
    await user.click(within(dialog).getByRole('button', { name: 'Přesunout' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const moved = rows.slice(0, 5).map((r) => r.id);
    const target = photosOf(world, other.id);
    expect(target).toHaveLength(targetBefore.length + 5);
    expect(
      photosOf(world, other.id)
        .slice(-5)
        .map((p) => p.id),
    ).toEqual(moved);
    const maxBefore = Math.max(...targetBefore.map((p) => p.sort));
    for (const p of photosOf(world, other.id).slice(-5)) expect(p.sort).toBeGreaterThan(maxBefore);
    expect(photosOf(world, album.id)).toHaveLength(rows.length - 5);
    // Only album_id and sort are written.
    for (const call of update.mock.calls) expect(Object.keys(call[1]).sort()).toEqual(['album_id', 'sort']);
    // Selection is cleared, the source cover is the first remaining photo, and the toast says so.
    expect(screen.queryByRole('region', { name: cs.photos.selectionBar })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(dbAlbum(world, album.id).cover_photo_id).toBe(rows[5]!.id);
    expect(await screen.findByText(cs.photos.coverReassigned)).toBeTruthy();
    expect(screen.getByText('Přesunuto: 5 fotek.')).toBeTruthy();
    await waitFor(() => expect(tileOf(rows[5]!.id).textContent).toContain('Titulní'));
  });

  it('works from the tile menu for a single photo and keeps a cover that did not move', async () => {
    const user = userEvent.setup();
    const { world, album, other } = setup();
    const rows = photosOf(world, album.id);
    await world.ports.catalog.updateAlbum(album.id, { cover_photo_id: rows[0]!.id });
    await open(world, album);
    await user.click(within(await openMenu(user, 2)).getByRole('button', { name: cs.photos.moveToOtherAlbum }));
    const dialog = await screen.findByRole('dialog', { name: 'Přesunout do alba' });
    await user.click(
      within(dialog)
        .getAllByRole('radio')
        .find((r) => (r as HTMLInputElement).value === other.id)!,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Přesunout' }));
    await waitFor(() => expect(photosOf(world, other.id).some((p) => p.id === rows[1]!.id)).toBe(true));
    expect(dbAlbum(world, album.id).cover_photo_id).toBe(rows[0]!.id);
    expect(screen.queryByText(cs.photos.coverReassigned)).toBeNull();
  });

  it('groups albums by category, offers search and cannot confirm without a target', async () => {
    const user = userEvent.setup();
    const { world, album } = setup();
    await open(world, album);
    await user.click(screen.getByRole('button', { name: 'Vybrat' }));
    await user.click(screen.getByRole('checkbox', { name: 'Vybrat fotku 1' }));
    await user.click(screen.getByRole('button', { name: 'Přesunout do alba' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByRole('group').length).toBeGreaterThan(1);
    expect((within(dialog).getByRole('button', { name: 'Přesunout' }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(within(dialog).getByLabelText(cs.photos.searchAlbums), 'zzzzzz');
    expect(within(dialog).getByText(cs.photos.noAlbumMatch)).toBeTruthy();
  });
});

describe('accessibility', () => {
  it('has no serious axe violations: grid, menu sheet, selection mode and move dialog', async () => {
    const user = userEvent.setup();
    const { world, album } = setup();
    await open(world, album);
    const run = () =>
      axe.run(document.body, {
        runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
        rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
      });
    const bad = (r: Awaited<ReturnType<typeof run>>) =>
      r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.html}`);
    expect(bad(await run())).toEqual([]);
    const menu = await openMenu(user, 2);
    expect(bad(await run())).toEqual([]);
    await user.click(within(menu).getByRole('button', { name: cs.photos.close }));
    await user.click(screen.getByRole('button', { name: 'Vybrat' }));
    await user.click(screen.getByRole('checkbox', { name: 'Vybrat fotku 1' }));
    expect(bad(await run())).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Přesunout do alba' }));
    await screen.findByRole('dialog');
    expect(bad(await run())).toEqual([]);
  });
});
