import axe from 'axe-core';
import { slugify, type AlbumRow, type CategoryRow, type PhotoRow } from '@mp/shared';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorld, fixtureSnapshot, type FakeWorld } from '../adapters/fake';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { keyboardDrag, mockRowRects } from '../components/keyboardDrag.testutil';
import { cs } from '../i18n/cs';
import { ApiError } from '../ports';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

interface Spec {
  name: string;
  albums: Array<{ title: string; published?: boolean; place?: string; shot_on?: string }>;
}

/** An empty world with the named categories (sort 10, 20, ...) and their albums (sort 10, 20, ...). */
async function worldWith(spec: Spec[]): Promise<FakeWorld> {
  const world = createFakeWorld({ signedIn: true });
  let sort = 10;
  for (const c of spec) {
    const category = await world.ports.catalog.createCategory({ slug: slugify(c.name), name: c.name, sort });
    sort += 10;
    let albumSort = 10;
    for (const a of c.albums) {
      await world.ports.catalog.createAlbum({
        category_id: category.id,
        slug: slugify(a.title),
        title: a.title,
        sort: albumSort,
        published: a.published ?? false,
        place: a.place ?? null,
        shot_on: a.shot_on ?? null,
      });
      albumSort += 10;
    }
  }
  return world;
}

const dbCategories = (world: FakeWorld) => world.snapshot().categories as CategoryRow[];
const dbAlbums = (world: FakeWorld) => world.snapshot().albums as AlbumRow[];
const albumByTitle = (world: FakeWorld, title: string) => dbAlbums(world).find((a) => a.title === title)!;

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

async function open(world: FakeWorld, path: string, heading: string | RegExp) {
  const view = render(
    <AppProviders ports={world.ports} retry={false} imgBaseUrl="https://img.test">
      <MemoryRouter initialEntries={[path]}>
        <App />
        <Where />
      </MemoryRouter>
    </AppProviders>,
  );
  await screen.findByRole('heading', { level: 1, name: heading });
  return view;
}

const categoryPath = (world: FakeWorld, name: string) => `/kategorie/${dbCategories(world).find((c) => c.name === name)!.id}`;
const list = () => screen.getByRole('list', { name: cs.categoryDetail.listLabel });
const rowTitles = () =>
  within(list())
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.row-title')!.textContent);
const row = (title: string) => screen.getByRole('link', { name: title }).closest('li') as HTMLElement;

describe('album list', () => {
  it('shows cover placeholder, title, place and date, status badge, photo count and the actions', async () => {
    const world = await worldWith([
      {
        name: 'Svatby',
        albums: [
          { title: 'Novákovi', published: true, place: 'Brno', shot_on: '2026-06-04' },
          { title: 'Dvořákovi' },
        ],
      },
    ]);
    await open(world, categoryPath(world, 'Svatby'), 'Svatby');
    await screen.findByRole('link', { name: 'Novákovi' });
    const first = row('Novákovi');
    await waitFor(() => expect(first.querySelector('.row-meta')!.textContent).toBe('Brno · 4. 6. 2026 · 0 fotek'));
    expect(within(first).getByText('Zveřejněno')).toBeTruthy();
    expect(first.querySelector('.cover-placeholder')).not.toBeNull();
    expect(first.querySelector('img')).toBeNull();
    expect(within(row('Dvořákovi')).getByText('Nezveřejněno')).toBeTruthy();
    expect(within(first).getByRole('link', { name: 'Otevřít: Novákovi' }).getAttribute('href')).toMatch(/^\/alba\//);
    expect(within(first).getByRole('button', { name: 'Skrýt album: Novákovi' })).toBeTruthy();
    expect(within(row('Dvořákovi')).getByRole('button', { name: 'Zveřejnit album: Dvořákovi' })).toBeTruthy();
    expect(within(first).getByRole('button', { name: 'Přesunout do jiné kategorie: Novákovi' })).toBeTruthy();
    expect(within(first).getByRole('button', { name: /^Smazat album: / })).toBeTruthy();
    // Breadcrumb: Kategorie / Svatby.
    const crumbs = screen.getByRole('navigation', { name: cs.categoryDetail.breadcrumbLabel });
    expect(within(crumbs).getByRole('link', { name: 'Kategorie' }).getAttribute('href')).toBe('/');
    expect(within(crumbs).getByText('Svatby').getAttribute('aria-current')).toBe('page');
  });

  it('shows the cover photo at 96 px from the image host', async () => {
    const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
    const albums = dbAlbums(world);
    const photos = world.snapshot().photos as PhotoRow[];
    const album = albums.find((a) => a.cover_photo_id && photos.some((p) => p.id === a.cover_photo_id))!;
    const category = dbCategories(world).find((c) => c.id === album.category_id)!;
    await open(world, `/kategorie/${category.id}`, category.name);
    const li = (await screen.findByRole('link', { name: album.title })).closest('li') as HTMLElement;
    await waitFor(() => expect(li.querySelector('img')).not.toBeNull());
    const img = li.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(`https://img.test/photos/${album.cover_photo_id}/480.webp`);
    expect(img.getAttribute('width')).toBe('96');
    expect(img.getAttribute('height')).toBe('96');
    expect(img.getAttribute('alt')).toBe('');
    expect(li.querySelector('.cover-placeholder')).toBeNull();
  });

  it('an empty category says so and offers "Nové album"', async () => {
    const world = await worldWith([{ name: 'Portréty', albums: [] }]);
    await open(world, categoryPath(world, 'Portréty'), 'Portréty');
    expect(await screen.findByText('V této kategorii zatím nejsou žádná alba.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Nové album' })).toHaveLength(2);
  });

  it('an unknown category says it was not found', async () => {
    const world = await worldWith([{ name: 'Svatby', albums: [] }]);
    render(
      <AppProviders ports={world.ports} retry={false}>
        <MemoryRouter initialEntries={['/kategorie/nope']}>
          <App />
        </MemoryRouter>
      </AppProviders>,
    );
    expect(await screen.findByText('Tuto kategorii jsme nenašli.')).toBeTruthy();
  });

  it('a failed load can be retried', async () => {
    const user = userEvent.setup();
    const world = await worldWith([{ name: 'Svatby', albums: [] }]);
    world.failNext('catalog.getCategory', 'network', 1);
    render(
      <AppProviders ports={world.ports} retry={false}>
        <MemoryRouter initialEntries={[categoryPath(world, 'Svatby')]}>
          <App />
        </MemoryRouter>
      </AppProviders>,
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Kategorii se nepodařilo načíst.');
    await user.click(within(alert).getByRole('button', { name: 'Zkusit znovu' }));
    await screen.findByRole('heading', { level: 1, name: 'Svatby' });
  });
});

describe('new album', () => {
  it('creates an unpublished album at the end and opens it as "Nezveřejněno" with the drop zone', async () => {
    const user = userEvent.setup();
    const world = await worldWith([
      { name: 'Svatby', albums: [{ title: 'Novákovi' }] },
      { name: 'Portréty', albums: [] },
    ]);
    await open(world, categoryPath(world, 'Svatby'), 'Svatby');
    await screen.findByRole('link', { name: 'Novákovi' });
    await user.click(screen.getByRole('button', { name: 'Nové album' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nové album' });
    expect(document.activeElement).toBe(within(dialog).getByLabelText(/^Název/));
    expect((within(dialog).getByLabelText('Kategorie') as HTMLSelectElement).value).toBe(
      dbCategories(world).find((c) => c.name === 'Svatby')!.id,
    );
    await user.type(within(dialog).getByLabelText(/^Název/), 'Čermákovi a spol.');
    await user.type(within(dialog).getByLabelText('Místo'), 'Znojmo');
    await user.type(within(dialog).getByLabelText('Datum focení'), '2026-07-11');
    await user.click(within(dialog).getByRole('button', { name: 'Vytvořit' }));

    const created = await waitFor(() => {
      const a = dbAlbums(world).find((x) => x.title === 'Čermákovi a spol.');
      expect(a).toBeTruthy();
      return a!;
    });
    expect(created).toMatchObject({
      slug: 'cermakovi-a-spol',
      published: false,
      place: 'Znojmo',
      shot_on: '2026-07-11',
      sort: 20,
      category_id: dbCategories(world).find((c) => c.name === 'Svatby')!.id,
    });
    await screen.findByRole('heading', { level: 1, name: 'Čermákovi a spol.' });
    expect(screen.getByTestId('where').textContent).toBe(`/alba/${created.id}`);
    expect(screen.getAllByText('Nezveřejněno').length).toBeGreaterThan(0);
    expect(screen.getByText('Přetáhněte sem fotky nebo klikněte pro výběr')).toBeTruthy();
  });

  it('an empty title is refused with "Vyplňte název." and focus on the field', async () => {
    const user = userEvent.setup();
    const world = await worldWith([{ name: 'Svatby', albums: [{ title: 'Novákovi' }] }]);
    const create = vi.spyOn(world.ports.catalog, 'createAlbum');
    await open(world, categoryPath(world, 'Svatby'), 'Svatby');
    await screen.findByRole('link', { name: 'Novákovi' });
    await user.click(screen.getByRole('button', { name: 'Nové album' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Vytvořit' }));
    expect(within(dialog).getByText('Vyplňte název.')).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByLabelText(/^Název/));
    expect(create).not.toHaveBeenCalled();
  });

  it('gives a repeated title its own address', async () => {
    const user = userEvent.setup();
    const world = await worldWith([{ name: 'Svatby', albums: [{ title: 'Novákovi' }] }]);
    await open(world, categoryPath(world, 'Svatby'), 'Svatby');
    await screen.findByRole('link', { name: 'Novákovi' });
    await user.click(screen.getByRole('button', { name: 'Nové album' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Název/), 'Novákovi');
    await user.click(within(dialog).getByRole('button', { name: 'Vytvořit' }));
    await waitFor(() => expect(dbAlbums(world).map((a) => a.slug).sort()).toEqual(['novakovi', 'novakovi-2']));
  });
});

describe('publish and hide', () => {
  it('an album without photos cannot be published and nothing is written', async () => {
    const user = userEvent.setup();
    const world = await worldWith([{ name: 'Svatby', albums: [{ title: 'Novákovi' }] }]);
    const update = vi.spyOn(world.ports.catalog, 'updateAlbum');
    await open(world, categoryPath(world, 'Svatby'), 'Svatby');
    await screen.findByRole('link', { name: 'Novákovi' });
    await user.click(screen.getByRole('button', { name: 'Zveřejnit album: Novákovi' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Album bez fotek nelze zveřejnit.');
    expect(update).not.toHaveBeenCalled();
    expect(albumByTitle(world, 'Novákovi').published).toBe(false);
    expect(within(row('Novákovi')).getByText('Nezveřejněno')).toBeTruthy();
  });

  it('an album with photos is published and the badge changes', async () => {
    const user = userEvent.setup();
    const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
    const photos = world.snapshot().photos as PhotoRow[];
    const album = dbAlbums(world).find((a) => photos.some((p) => p.album_id === a.id))!;
    await world.ports.catalog.updateAlbum(album.id, { published: false });
    const category = dbCategories(world).find((c) => c.id === album.category_id)!;
    await open(world, `/kategorie/${category.id}`, category.name);
    await screen.findByRole('link', { name: album.title });
    await user.click(screen.getByRole('button', { name: `Zveřejnit album: ${album.title}` }));
    await waitFor(() => expect(within(row(album.title)).getByText('Zveřejněno')).toBeTruthy());
    expect(dbAlbums(world).find((a) => a.id === album.id)!.published).toBe(true);
  });

  it('hiding asks first with the F4 sentence; the badge turns to "Nezveřejněno"; "Zveřejnit album" reverses it', async () => {
    const user = userEvent.setup();
    const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
    const photos = world.snapshot().photos as PhotoRow[];
    const album = dbAlbums(world).find((a) => photos.some((p) => p.album_id === a.id))!;
    const category = dbCategories(world).find((c) => c.id === album.category_id)!;
    await open(world, `/kategorie/${category.id}`, category.name);
    await screen.findByRole('link', { name: album.title });
    await user.click(screen.getByRole('button', { name: `Skrýt album: ${album.title}` }));
    const dialog = await screen.findByRole('dialog', { name: `Skrýt album ${album.title}?` });
    expect(dialog.textContent).toContain('Z veřejného webu zmizí po dalším zveřejnění. Fotky zůstanou uložené.');
    expect(dbAlbums(world).find((a) => a.id === album.id)!.published).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: 'Skrýt album' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(dbAlbums(world).find((a) => a.id === album.id)!.published).toBe(false);
    await waitFor(() => expect(within(row(album.title)).getByText('Nezveřejněno')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: `Zveřejnit album: ${album.title}` }));
    await waitFor(() => expect(within(row(album.title)).getByText('Zveřejněno')).toBeTruthy());
  });

  it('cancelling the hide dialog changes nothing', async () => {
    const user = userEvent.setup();
    const world = await worldWith([{ name: 'Svatby', albums: [{ title: 'Novákovi', published: true }] }]);
    const update = vi.spyOn(world.ports.catalog, 'updateAlbum');
    await open(world, categoryPath(world, 'Svatby'), 'Svatby');
    await screen.findByRole('link', { name: 'Novákovi' });
    await user.click(screen.getByRole('button', { name: 'Skrýt album: Novákovi' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Zrušit' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('move to another category', () => {
  it('removes the row from the list and puts the album last in the target category', async () => {
    const user = userEvent.setup();
    const world = await worldWith([
      { name: 'Svatby', albums: [{ title: 'Novákovi' }, { title: 'Dvořákovi' }] },
      { name: 'Portréty', albums: [{ title: 'Jana' }] },
    ]);
    await open(world, categoryPath(world, 'Svatby'), 'Svatby');
    await screen.findByRole('link', { name: 'Novákovi' });
    await user.click(screen.getByRole('button', { name: 'Přesunout do jiné kategorie: Novákovi' }));
    const dialog = await screen.findByRole('dialog', { name: 'Přesunout album Novákovi' });
    // Only the other categories are offered.
    expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual(['Portréty']);
    await user.click(within(dialog).getByRole('button', { name: 'Přesunout' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(rowTitles()).toEqual(['Dvořákovi']));
    const moved = albumByTitle(world, 'Novákovi');
    expect(moved.category_id).toBe(dbCategories(world).find((c) => c.name === 'Portréty')!.id);
    expect(moved.sort).toBe(20);
  });

  it('is unavailable when there is no other category', async () => {
    const world = await worldWith([{ name: 'Svatby', albums: [{ title: 'Novákovi' }] }]);
    await open(world, categoryPath(world, 'Svatby'), 'Svatby');
    await screen.findByRole('link', { name: 'Novákovi' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Přesunout do jiné kategorie: Novákovi' })).toHaveProperty('disabled', true),
    );
  });
});

describe('edit category', () => {
  it('"Upravit kategorii" renames it and the heading and breadcrumb follow', async () => {
    const user = userEvent.setup();
    const world = await worldWith([{ name: 'Svatby', albums: [] }]);
    await open(world, categoryPath(world, 'Svatby'), 'Svatby');
    await user.click(await screen.findByRole('button', { name: 'Upravit kategorii' }));
    const dialog = await screen.findByRole('dialog', { name: 'Upravit kategorii' });
    const name = within(dialog).getByLabelText(/^Název/);
    await user.clear(name);
    await user.type(name, 'Svatební den');
    await user.click(within(dialog).getByRole('button', { name: 'Uložit' }));
    await screen.findByRole('heading', { level: 1, name: 'Svatební den' });
    const crumbs = screen.getByRole('navigation', { name: cs.categoryDetail.breadcrumbLabel });
    expect(within(crumbs).getByText('Svatební den')).toBeTruthy();
  });
});

describe('reorder', () => {
  it('has no text move buttons, only drag handles', async () => {
    const world = await worldWith([{ name: 'Svatby', albums: [{ title: 'A1' }, { title: 'B2' }] }]);
    await open(world, categoryPath(world, 'Svatby'), 'Svatby');
    await screen.findByRole('link', { name: 'A1' });
    expect(screen.queryByRole('button', { name: /Posunout|Přesunout do pozice/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Přetáhnout: A1' })).toBeTruthy();
  });

  it('a keyboard drag persists with the midpoint rule and says "Pořadí uloženo"', async () => {
    mockRowRects();
    const user = userEvent.setup();
    const world = await worldWith([
      { name: 'Svatby', albums: [{ title: 'A1' }, { title: 'B2' }, { title: 'C3' }] },
    ]);
    await open(world, categoryPath(world, 'Svatby'), 'Svatby');
    await screen.findByRole('link', { name: 'A1' });
    await keyboardDrag(user, 'Přetáhnout: A1', 1);
    await waitFor(() =>
      expect(
        dbAlbums(world)
          .slice()
          .sort((a, b) => a.sort - b.sort)
          .map((a) => a.title),
      ).toEqual(['B2', 'A1', 'C3']),
    );
    expect(await screen.findByText('Pořadí uloženo')).toBeTruthy();
    await waitFor(() => expect(rowTitles()).toEqual(['B2', 'A1', 'C3']));
    expect(albumByTitle(world, 'A1').sort).toBe(25);
  });

  it('a failed save puts the list back and offers a retry', async () => {
    mockRowRects();
    const user = userEvent.setup();
    const world = await worldWith([{ name: 'Svatby', albums: [{ title: 'A1' }, { title: 'B2' }] }]);
    await open(world, categoryPath(world, 'Svatby'), 'Svatby');
    await screen.findByRole('link', { name: 'A1' });
    world.failNext('catalog.updateAlbum', new ApiError('INTERNAL'));
    await keyboardDrag(user, 'Přetáhnout: A1', 1);
    const alert = await screen.findByText('Pořadí se nepodařilo uložit');
    expect(rowTitles()).toEqual(['A1', 'B2']);
    await user.click(within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Zkusit znovu' }));
    await waitFor(() => expect(rowTitles()).toEqual(['B2', 'A1']));
  });
});

describe('accessibility', () => {
  it('has no serious axe violations: list and new-album dialog', async () => {
    const user = userEvent.setup();
    const world = await worldWith([
      { name: 'Svatby', albums: [{ title: 'Novákovi', published: true, place: 'Brno' }, { title: 'Dvořákovi' }] },
      { name: 'Portréty', albums: [] },
    ]);
    await open(world, categoryPath(world, 'Svatby'), 'Svatby');
    await screen.findByRole('link', { name: 'Novákovi' });
    await waitFor(() => expect(row('Novákovi').querySelector('.row-meta')!.textContent).toContain('0 fotek'));
    const run = () =>
      axe.run(document.body, {
        runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
        rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
      });
    const bad = (r: Awaited<ReturnType<typeof run>>) =>
      r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.html}`);
    expect(bad(await run())).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Nové album' }));
    await screen.findByRole('dialog');
    expect(bad(await run())).toEqual([]);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Přesunout do jiné kategorie: Novákovi' }));
    await screen.findByRole('dialog');
    expect(bad(await run())).toEqual([]);
  });
});
