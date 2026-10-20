import axe from 'axe-core';
import { slugify, type AlbumRow, type CategoryRow, type PhotoRow } from '@mp/shared';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorld, fixtureSnapshot, type FakeWorld } from '../adapters/fake';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { cs } from '../i18n/cs';
import { formatCount } from '../i18n/format';
import { ApiError } from '../ports';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** An empty world with the named categories (sort 10, 20, ...) holding the given number of albums. */
async function worldWith(spec: Array<[name: string, albums: number]>): Promise<FakeWorld> {
  const world = createFakeWorld({ signedIn: true });
  let sort = 10;
  for (const [name, albums] of spec) {
    const category = await world.ports.catalog.createCategory({ slug: slugify(name), name, sort });
    sort += 10;
    for (let i = 0; i < albums; i++) {
      await world.ports.catalog.createAlbum({
        category_id: category.id,
        slug: `${category.slug}-${i + 1}`,
        title: `Album ${i + 1}`,
      });
    }
  }
  return world;
}

async function open(world: FakeWorld) {
  const view = render(
    <AppProviders ports={world.ports} retry={false}>
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    </AppProviders>,
  );
  await screen.findByRole('heading', { level: 1, name: cs.routes.categories.title });
  return view;
}

const dbCategories = (world: FakeWorld) =>
  (world.snapshot().categories as CategoryRow[]).slice().sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
const dbNames = (world: FakeWorld) => dbCategories(world).map((c) => c.name);
const rowNames = () =>
  within(screen.getByRole('list', { name: cs.categories.listLabel }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.row-title')!.textContent);
const row = (name: string) =>
  screen.getByRole('link', { name }).closest('li') as HTMLElement;

describe('list', () => {
  it('shows every category with album and photo counts, the visibility badge and the large storage bar', async () => {
    const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
    await open(world);
    const snap = world.snapshot();
    const categories = dbCategories(world);
    const albums = snap.albums as AlbumRow[];
    const photos = snap.photos as PhotoRow[];
    await waitFor(() => expect(rowNames()).toEqual(categories.map((c) => c.name)));
    for (const c of categories) {
      const own = albums.filter((a) => a.category_id === c.id);
      const photoCount = photos.filter((p) => own.some((a) => a.id === p.album_id)).length;
      const expected = `${formatCount(own.length, cs.units.album)}, ${formatCount(photoCount, cs.units.photo)}`;
      await waitFor(() => expect(row(c.name).querySelector('.row-meta')!.textContent).toBe(expected));
      expect(within(row(c.name)).getByText('Viditelná')).toBeTruthy();
      expect(within(row(c.name)).getByRole('link', { name: c.name }).getAttribute('href')).toBe(`/kategorie/${c.id}`);
    }
    await waitFor(() => expect(document.querySelector('.storage-large progress')).not.toBeNull());
  });

  it('empty: sentence and "Nová kategorie"', async () => {
    const world = createFakeWorld({ signedIn: true });
    await open(world);
    expect(await screen.findByText('Zatím tu nejsou žádné kategorie.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Nová kategorie' })).toHaveLength(1);
  });

  it('a failed load says so, and "Zkusit znovu" recovers', async () => {
    const user = userEvent.setup();
    const world = await worldWith([['Svatby', 0]]);
    world.failNext('catalog.listCategories', 'network', 1);
    await open(world);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Kategorie se nepodařilo načíst.');
    await user.click(within(alert).getByRole('button', { name: 'Zkusit znovu' }));
    await screen.findByRole('link', { name: 'Svatby' });
  });
});

describe('create and edit', () => {
  it('creates a category: address follows the name, it lands last, focus returns to the button', async () => {
    const user = userEvent.setup();
    const world = await worldWith([['Svatby', 0], ['Portréty', 0]]);
    await open(world);
    await screen.findByRole('link', { name: 'Svatby' });
    const trigger = screen.getByRole('button', { name: 'Nová kategorie' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Nová kategorie' });
    expect(document.activeElement).toBe(within(dialog).getByLabelText(/^Název/));
    await user.type(within(dialog).getByLabelText(/^Název/), 'Žluté pole');
    expect((within(dialog).getByLabelText(/^Adresa/) as HTMLInputElement).value).toBe('zlute-pole');
    await user.click(within(dialog).getByRole('button', { name: 'Vytvořit' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(dbNames(world)).toEqual(['Svatby', 'Portréty', 'Žluté pole']);
    expect(dbCategories(world)[2]!.slug).toBe('zlute-pole');
    await waitFor(() => expect(rowNames()).toEqual(['Svatby', 'Portréty', 'Žluté pole']));
    expect(document.activeElement).toBe(trigger);
  });

  it('an empty name is refused with "Vyplňte název." and focus on the field', async () => {
    const user = userEvent.setup();
    const world = await worldWith([['Svatby', 0]]);
    const create = vi.spyOn(world.ports.catalog, 'createCategory');
    await open(world);
    await user.click(await screen.findByRole('button', { name: 'Nová kategorie' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Vytvořit' }));
    expect(within(dialog).getByText('Vyplňte název.')).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByLabelText(/^Název/));
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses the reserved address "portfolio" without calling the server', async () => {
    const user = userEvent.setup();
    const world = await worldWith([['Svatby', 0]]);
    const create = vi.spyOn(world.ports.catalog, 'createCategory');
    await open(world);
    await user.click(await screen.findByRole('button', { name: 'Nová kategorie' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Název/), 'Portfolio');
    expect((within(dialog).getByLabelText(/^Adresa/) as HTMLInputElement).value).toBe('portfolio');
    await user.click(within(dialog).getByRole('button', { name: 'Vytvořit' }));
    expect(within(dialog).getByText(cs.categories.slugReserved)).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByLabelText(/^Adresa/));
    expect(create).not.toHaveBeenCalled();
    expect(dbNames(world)).toEqual(['Svatby']);
  });

  it('a taken address is refused with a suggestion that can be applied', async () => {
    const user = userEvent.setup();
    const world = await worldWith([['Svatby', 0]]);
    await open(world);
    await user.click(await screen.findByRole('button', { name: 'Nová kategorie' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Název/), 'Svatby');
    await user.click(within(dialog).getByRole('button', { name: 'Vytvořit' }));
    expect(within(dialog).getByText('Tato adresa je už použitá.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Použít adresu svatby-2' }));
    expect((within(dialog).getByLabelText(/^Adresa/) as HTMLInputElement).value).toBe('svatby-2');
    await user.click(within(dialog).getByRole('button', { name: 'Vytvořit' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(dbCategories(world).map((c) => c.slug)).toEqual(['svatby', 'svatby-2']);
  });

  it('edits the name and warns before the address changes', async () => {
    const user = userEvent.setup();
    const world = await worldWith([['Svatby', 0]]);
    await open(world);
    await screen.findByRole('link', { name: 'Svatby' });
    await user.click(screen.getByRole('button', { name: 'Přejmenovat: Svatby' }));
    const dialog = await screen.findByRole('dialog', { name: 'Upravit kategorii' });
    const name = within(dialog).getByLabelText(/^Název/);
    await user.clear(name);
    await user.type(name, 'Svatební den');
    // Renaming keeps the address; no warning yet.
    expect((within(dialog).getByLabelText(/^Adresa/) as HTMLInputElement).value).toBe('svatby');
    expect(within(dialog).queryByText(cs.categories.slugChangeWarning)).toBeNull();
    const slug = within(dialog).getByLabelText(/^Adresa/);
    await user.clear(slug);
    await user.type(slug, 'svatebni-den');
    expect(within(dialog).getByText('Změna adresy rozbije stávající odkazy na tuto kategorii a její alba.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Uložit' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(dbCategories(world)[0]).toMatchObject({ name: 'Svatební den', slug: 'svatebni-den' });
    await screen.findByRole('link', { name: 'Svatební den' });
  });

  it('shows "changed elsewhere" when the category changed meanwhile', async () => {
    const user = userEvent.setup();
    const world = await worldWith([['Svatby', 0]]);
    await open(world);
    await screen.findByRole('link', { name: 'Svatby' });
    await user.click(screen.getByRole('button', { name: 'Přejmenovat: Svatby' }));
    const dialog = await screen.findByRole('dialog');
    // Another tab saves first.
    const id = dbCategories(world)[0]!.id;
    await world.ports.catalog.updateCategory(id, { description: 'jinde' });
    const name = within(dialog).getByLabelText(/^Název/);
    await user.clear(name);
    await user.type(name, 'Jiný název');
    await user.click(within(dialog).getByRole('button', { name: 'Uložit' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toBe(`Tato kategorie byla změněna jinde.${cs.data.reload}`);
    expect(dbNames(world)).toEqual(['Svatby']);
  });

  it('Escape closes the dialog and focus returns to the button that opened it', async () => {
    const user = userEvent.setup();
    const world = await worldWith([['Svatby', 0]]);
    await open(world);
    await screen.findByRole('link', { name: 'Svatby' });
    const opener = screen.getByRole('button', { name: 'Přejmenovat: Svatby' });
    await user.click(opener);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('hide and show', () => {
  it('hiding asks first, names the album count, and the badge turns to "Skrytá"; showing needs no dialog', async () => {
    const user = userEvent.setup();
    const world = await worldWith([['Svatby', 4], ['Portréty', 0]]);
    await open(world);
    await screen.findByRole('link', { name: 'Svatby' });
    await waitFor(() => expect(row('Svatby').querySelector('.row-meta')!.textContent).toContain('4 alba'));
    await user.click(screen.getByRole('button', { name: 'Skrýt kategorii: Svatby' }));
    const dialog = await screen.findByRole('dialog', { name: 'Skrýt kategorii Svatby?' });
    expect(dialog.textContent).toContain(
      'Z veřejného webu zmizí po dalším zveřejnění spolu se všemi jejími alby (4 alba). Fotky zůstanou uložené.',
    );
    expect(dbCategories(world)[0]!.visible).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: 'Skrýt kategorii' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(dbCategories(world)[0]!.visible).toBe(false);
    await waitFor(() => expect(within(row('Svatby')).getByText('Skrytá')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Zobrazit kategorii: Svatby' }));
    await waitFor(() => expect(within(row('Svatby')).getByText('Viditelná')).toBeTruthy());
    expect(dbCategories(world)[0]!.visible).toBe(true);
  });

  it('an empty category is hidden with the short sentence', async () => {
    const user = userEvent.setup();
    const world = await worldWith([['Portréty', 0]]);
    await open(world);
    await screen.findByRole('link', { name: 'Portréty' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Skrýt kategorii: Portréty' })).toHaveProperty('disabled', false));
    await user.click(screen.getByRole('button', { name: 'Skrýt kategorii: Portréty' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Z veřejného webu zmizí po dalším zveřejnění. Fotky zůstanou uložené.');
  });
});

describe('delete', () => {
  it('a category with albums gets the exact sentence and no delete request is made', async () => {
    const user = userEvent.setup();
    const world = await worldWith([['Svatby', 4]]);
    const remove = vi.spyOn(world.ports.catalog, 'deleteCategory');
    await open(world);
    await screen.findByRole('link', { name: 'Svatby' });
    await waitFor(() => expect(row('Svatby').querySelector('.row-meta')!.textContent).toContain('4 alba'));
    await user.click(screen.getByRole('button', { name: 'Smazat: Svatby' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Kategorie obsahuje 4 alba. Nejdřív album přesuňte nebo smažte, nebo kategorii skryjte.')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Smazat' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Zavřít' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(remove).not.toHaveBeenCalled();
    expect(dbNames(world)).toEqual(['Svatby']);
  });

  it('an empty category is deleted after a confirmation', async () => {
    const user = userEvent.setup();
    const world = await worldWith([['Svatby', 1], ['Portréty', 0]]);
    const remove = vi.spyOn(world.ports.catalog, 'deleteCategory');
    await open(world);
    await screen.findByRole('link', { name: 'Portréty' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Smazat: Portréty' })).toHaveProperty('disabled', false));
    await user.click(screen.getByRole('button', { name: 'Smazat: Portréty' }));
    const dialog = await screen.findByRole('dialog', { name: 'Smazat kategorii Portréty?' });
    expect(remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Smazat' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(remove).toHaveBeenCalledTimes(1);
    expect(dbNames(world)).toEqual(['Svatby']);
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Portréty' })).toBeNull());
    // The opener is gone, so focus goes to the page heading.
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });
});

describe('reorder', () => {
  it('"Posunout dolů" persists in the fake world and says "Pořadí uloženo"', async () => {
    const user = userEvent.setup();
    const world = await worldWith([['Svatby', 0], ['Portréty', 0], ['Rodina', 0]]);
    await open(world);
    await screen.findByRole('link', { name: 'Svatby' });
    await user.click(screen.getByRole('button', { name: 'Posunout dolů: Svatby' }));
    await waitFor(() => expect(dbNames(world)).toEqual(['Portréty', 'Svatby', 'Rodina']));
    expect(await screen.findByText('Pořadí uloženo')).toBeTruthy();
    await waitFor(() => expect(rowNames()).toEqual(['Portréty', 'Svatby', 'Rodina']));
    // Only the moved row was written (midpoint).
    expect(dbCategories(world).map((c) => c.sort)).toEqual([20, 25, 30]);
  });

  it('"Přesunout do pozice…" to the start persists', async () => {
    const user = userEvent.setup();
    const world = await worldWith([['Svatby', 0], ['Portréty', 0], ['Rodina', 0]]);
    await open(world);
    await screen.findByRole('link', { name: 'Rodina' });
    await user.click(screen.getByRole('button', { name: 'Přesunout do pozice… Rodina' }));
    await user.clear(screen.getByLabelText('Nová pozice (1 až 3)'));
    await user.type(screen.getByLabelText('Nová pozice (1 až 3)'), '1{Enter}');
    await waitFor(() => expect(dbNames(world)).toEqual(['Rodina', 'Svatby', 'Portréty']));
  });

  it('a failed save puts the list back and offers a retry that then saves', async () => {
    const user = userEvent.setup();
    const world = await worldWith([['Svatby', 0], ['Portréty', 0]]);
    await open(world);
    await screen.findByRole('link', { name: 'Svatby' });
    world.failNext('catalog.updateCategory', new ApiError('INTERNAL'));
    await user.click(screen.getByRole('button', { name: 'Posunout dolů: Svatby' }));
    const alert = await screen.findByText('Pořadí se nepodařilo uložit');
    expect(rowNames()).toEqual(['Svatby', 'Portréty']);
    expect(dbNames(world)).toEqual(['Svatby', 'Portréty']);
    await user.click(within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Zkusit znovu' }));
    await waitFor(() => expect(dbNames(world)).toEqual(['Portréty', 'Svatby']));
    await waitFor(() => expect(rowNames()).toEqual(['Portréty', 'Svatby']));
  });
});

describe('accessibility', () => {
  it('has no serious axe violations: list, create dialog, delete dialog', async () => {
    const user = userEvent.setup();
    const world = await worldWith([['Svatby', 2], ['Portréty', 0]]);
    const { container } = await open(world);
    await screen.findByRole('link', { name: 'Svatby' });
    await waitFor(() => expect(row('Svatby').querySelector('.row-meta')!.textContent).toContain('2 alba'));
    const run = () =>
      axe.run(document.body, {
        runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
        rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
      });
    const bad = (r: Awaited<ReturnType<typeof run>>) =>
      r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.html}`);
    expect(container).toBeTruthy();
    expect(bad(await run())).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Nová kategorie' }));
    await screen.findByRole('dialog');
    expect(bad(await run())).toEqual([]);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Smazat: Svatby' }));
    await screen.findByRole('dialog');
    expect(bad(await run())).toEqual([]);
  });
});
