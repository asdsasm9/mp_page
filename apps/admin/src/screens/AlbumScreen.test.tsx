import axe from 'axe-core';
import { slugify, type AlbumRow, type CategoryRow } from '@mp/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorld, type FakeWorld } from '../adapters/fake';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { cs } from '../i18n/cs';
import { ApiError } from '../ports';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Categories Svatby and Portréty; Svatby holds the albums "Novákovi" (Brno) and "Dvořákovi". */
async function makeWorld(): Promise<FakeWorld> {
  const world = createFakeWorld({ signedIn: true });
  const svatby = await world.ports.catalog.createCategory({ slug: 'svatby', name: 'Svatby', sort: 10 });
  await world.ports.catalog.createCategory({ slug: 'portrety', name: 'Portréty', sort: 20 });
  await world.ports.catalog.createAlbum({
    category_id: svatby.id,
    slug: 'novakovi',
    title: 'Novákovi',
    place: 'Brno',
    sort: 10,
  });
  await world.ports.catalog.createAlbum({
    category_id: svatby.id,
    slug: slugify('Dvořákovi'),
    title: 'Dvořákovi',
    sort: 20,
  });
  return world;
}

const dbAlbum = (world: FakeWorld, title: string) =>
  (world.snapshot().albums as AlbumRow[]).find((a) => a.title === title || a.id === title)!;
const dbCategory = (world: FakeWorld, name: string) =>
  (world.snapshot().categories as CategoryRow[]).find((c) => c.name === name)!;

async function open(world: FakeWorld, albumTitle = 'Novákovi') {
  const album = dbAlbum(world, albumTitle);
  const view = render(
    <AppProviders ports={world.ports} retry={false}>
      <MemoryRouter initialEntries={[`/alba/${album.id}`]}>
        <App />
      </MemoryRouter>
    </AppProviders>,
  );
  await screen.findByRole('heading', { level: 1, name: albumTitle });
  await screen.findByLabelText('Místo');
  return { ...view, album };
}

/** Spy that lets the test hold an update until `release` is called. */
function holdNextUpdate(world: FakeWorld) {
  const real = world.ports.catalog.updateAlbum.bind(world.ports.catalog);
  let release: () => void = () => undefined;
  const spy = vi.spyOn(world.ports.catalog, 'updateAlbum').mockImplementationOnce(
    (...args) =>
      new Promise((resolve, reject) => {
        release = () => real(...args).then(resolve, reject);
      }),
  );
  return { spy, release: () => release() };
}

describe('screen', () => {
  it('shows breadcrumb, title, status, actions and the drop zone placeholder', async () => {
    const world = await makeWorld();
    await open(world);
    const crumbs = screen.getByRole('navigation', { name: cs.categoryDetail.breadcrumbLabel });
    expect(within(crumbs).getByRole('link', { name: 'Kategorie' }).getAttribute('href')).toBe('/');
    expect(within(crumbs).getByRole('link', { name: 'Svatby' }).getAttribute('href')).toBe(`/kategorie/${dbCategory(world, 'Svatby').id}`);
    expect(within(crumbs).getByText('Novákovi').getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('Nezveřejněno')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zveřejnit album' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Přesunout do jiné kategorie' })).toBeTruthy();
    expect(screen.getByText('Přetáhněte sem fotky nebo klikněte pro výběr')).toBeTruthy();
    await screen.findByText('V albu zatím nejsou žádné fotky.');
    expect(screen.queryByRole('button', { name: /Smazat/ })).toBeNull();
  });

  it('says drafts are unlisted, not private, and drops the hint once published', async () => {
    const world = await makeWorld();
    await world.ports.catalog.updateAlbum(dbAlbum(world, 'Dvořákovi').id, { published: true });
    await open(world);
    expect(screen.getByText(cs.album.draftHint)).toBeTruthy();
    cleanup();
    await open(world, 'Dvořákovi');
    expect(screen.queryByText(cs.album.draftHint)).toBeNull();
    expect(screen.getByText('Zveřejněno')).toBeTruthy();
  });

  it('an unknown album says it was not found', async () => {
    const world = await makeWorld();
    render(
      <AppProviders ports={world.ports} retry={false}>
        <MemoryRouter initialEntries={['/alba/nope']}>
          <App />
        </MemoryRouter>
      </AppProviders>,
    );
    expect(await screen.findByText('Toto album jsme nenašli.')).toBeTruthy();
  });

  it('an album without photos cannot be published', async () => {
    const user = userEvent.setup();
    const world = await makeWorld();
    const update = vi.spyOn(world.ports.catalog, 'updateAlbum');
    await open(world);
    await user.click(screen.getByRole('button', { name: 'Zveřejnit album' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Album bez fotek nelze zveřejnit.');
    expect(update).not.toHaveBeenCalled();
  });

  it('moving to another category updates the breadcrumb', async () => {
    const user = userEvent.setup();
    const world = await makeWorld();
    await open(world);
    await user.click(screen.getByRole('button', { name: 'Přesunout do jiné kategorie' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Přesunout' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const crumbs = screen.getByRole('navigation', { name: cs.categoryDetail.breadcrumbLabel });
    await waitFor(() =>
      expect(within(crumbs).getByRole('link', { name: 'Portréty' }).getAttribute('href')).toBe(
        `/kategorie/${dbCategory(world, 'Portréty').id}`,
      ),
    );
    expect(within(crumbs).queryByRole('link', { name: 'Svatby' })).toBeNull();
    expect(dbAlbum(world, 'Novákovi').category_id).toBe(dbCategory(world, 'Portréty').id);
  });
});

describe('autosave on blur', () => {
  it('saves a changed field once when it loses focus, and nothing when it is unchanged', async () => {
    const user = userEvent.setup();
    const world = await makeWorld();
    const update = vi.spyOn(world.ports.catalog, 'updateAlbum');
    await open(world);
    const place = screen.getByLabelText('Místo');
    // Unchanged: focus and leave.
    await user.click(place);
    await user.tab();
    expect(update).not.toHaveBeenCalled();
    // Changed: one write with only that column.
    await user.click(place);
    await user.clear(place);
    await user.type(place, 'Praha');
    expect(update).not.toHaveBeenCalled();
    await user.tab();
    await waitFor(() => expect(dbAlbum(world, 'Novákovi').place).toBe('Praha'));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![1]).toEqual({ place: 'Praha' });
    // Focus again and leave without a change: still one write.
    await user.click(place);
    await user.tab();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('Enter saves, and the blur after it does not save again', async () => {
    const user = userEvent.setup();
    const world = await makeWorld();
    const update = vi.spyOn(world.ports.catalog, 'updateAlbum');
    await open(world);
    const place = screen.getByLabelText('Místo');
    await user.clear(place);
    await user.type(place, 'Olomouc{Enter}');
    await user.tab();
    await waitFor(() => expect(dbAlbum(world, 'Novákovi').place).toBe('Olomouc'));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('stores an emptied optional field as null', async () => {
    const user = userEvent.setup();
    const world = await makeWorld();
    await open(world);
    const place = screen.getByLabelText('Místo');
    await user.clear(place);
    await user.tab();
    await waitFor(() => expect(dbAlbum(world, 'Novákovi').place).toBeNull());
  });

  it('shows "Ukládám…" while the save runs and "Uloženo" afterwards', async () => {
    const user = userEvent.setup();
    const world = await makeWorld();
    const held = holdNextUpdate(world);
    await open(world);
    await user.type(screen.getByLabelText('Popis'), 'Letní svatba');
    await user.tab();
    const status = document.querySelector('.save-status')!;
    await waitFor(() => expect(status.textContent).toBe('Ukládám…'));
    await act(async () => {
      held.release();
    });
    await waitFor(() => expect(status.textContent).toBe('Uloženo'));
    expect(dbAlbum(world, 'Novákovi').description).toBe('Letní svatba');
  });

  it('a failed save keeps the typed value and "Zkusit znovu" saves it', async () => {
    const user = userEvent.setup();
    const world = await makeWorld();
    await open(world);
    world.failNext('catalog.updateAlbum', new ApiError('INTERNAL'));
    const place = screen.getByLabelText('Místo');
    await user.clear(place);
    await user.type(place, 'Plzeň');
    await user.tab();
    const alert = await screen.findByText('Změny se nepodařilo uložit.');
    expect((place as HTMLInputElement).value).toBe('Plzeň');
    expect(dbAlbum(world, 'Novákovi').place).toBe('Brno');
    await user.click(within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Zkusit znovu' }));
    await waitFor(() => expect(dbAlbum(world, 'Novákovi').place).toBe('Plzeň'));
    await waitFor(() => expect(screen.queryByText('Změny se nepodařilo uložit.')).toBeNull());
    expect((place as HTMLInputElement).value).toBe('Plzeň');
  });

  it('blurring two fields quickly saves both without a "changed elsewhere" error', async () => {
    const user = userEvent.setup();
    const world = await makeWorld();
    await open(world);
    await user.type(screen.getByLabelText('Místo'), ' nad Svitavou');
    await user.tab();
    await user.tab();
    await user.type(screen.getByLabelText('Popis'), 'Popis alba');
    await user.tab();
    await waitFor(() => expect(dbAlbum(world, 'Novákovi').description).toBe('Popis alba'));
    expect(dbAlbum(world, 'Novákovi').place).toBe('Brno nad Svitavou');
    expect(screen.queryByText(cs.data.staleSentenceBy.album)).toBeNull();
  });

  it('shot_on is stored as YYYY-MM-DD', async () => {
    const user = userEvent.setup();
    const world = await makeWorld();
    await open(world);
    await user.type(screen.getByLabelText('Datum focení'), '2026-06-14');
    await user.tab();
    await waitFor(() => expect(dbAlbum(world, 'Novákovi').shot_on).toBe('2026-06-14'));
  });

  it('a date that does not exist is refused without a write', async () => {
    const world = await makeWorld();
    const update = vi.spyOn(world.ports.catalog, 'updateAlbum');
    await open(world);
    const date = screen.getByLabelText('Datum focení');
    // A browser without a date picker lets the text through; jsdom needs a text type for that.
    date.setAttribute('type', 'text');
    fireEvent.change(date, { target: { value: '2026-02-30' } });
    fireEvent.blur(date);
    expect(await screen.findByText('Zadejte datum ve tvaru RRRR-MM-DD.')).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it('"changed elsewhere" is announced with a reload that brings in the other change', async () => {
    const user = userEvent.setup();
    const world = await makeWorld();
    const { album } = await open(world);
    await world.ports.catalog.updateAlbum(album.id, { description: 'jinde změněno' });
    const place = screen.getByLabelText('Místo');
    await user.clear(place);
    await user.type(place, 'Kolín');
    await user.tab();
    const alert = await screen.findByText(cs.data.staleSentenceBy.album);
    expect(dbAlbum(world, 'Novákovi').place).toBe('Brno');
    await user.click(within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Načíst znovu' }));
    await waitFor(() => expect((screen.getByLabelText('Popis') as HTMLTextAreaElement).value).toBe('jinde změněno'));
    expect((screen.getByLabelText('Místo') as HTMLInputElement).value).toBe('Brno');
    expect(screen.queryByText(cs.data.staleSentenceBy.album)).toBeNull();
  });
});

describe('title', () => {
  it('is renamed inline and saved on blur', async () => {
    const user = userEvent.setup();
    const world = await makeWorld();
    const update = vi.spyOn(world.ports.catalog, 'updateAlbum');
    await open(world);
    await user.click(screen.getByRole('button', { name: 'Přejmenovat album' }));
    const input = screen.getByLabelText('Název');
    expect(document.activeElement).toBe(input);
    await user.clear(input);
    await user.type(input, 'Novákovi 2026');
    await user.tab();
    await screen.findByRole('heading', { level: 1, name: 'Novákovi 2026' });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![1]).toEqual({ title: 'Novákovi 2026' });
    // The address is not touched by a rename.
    expect(dbAlbum(world, 'Novákovi 2026').slug).toBe('novakovi');
  });

  it('an empty title is refused with "Vyplňte název." and focus stays on the field', async () => {
    const user = userEvent.setup();
    const world = await makeWorld();
    const update = vi.spyOn(world.ports.catalog, 'updateAlbum');
    await open(world);
    await user.click(screen.getByRole('button', { name: 'Přejmenovat album' }));
    const input = screen.getByLabelText('Název');
    await user.clear(input);
    await user.tab();
    expect(await screen.findByText('Vyplňte název.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Název'));
    expect(update).not.toHaveBeenCalled();
    // Typing a title clears the message and Enter saves.
    await user.type(screen.getByLabelText('Název'), 'Nový název{Enter}');
    await screen.findByRole('heading', { level: 1, name: 'Nový název' });
    expect(screen.queryByText('Vyplňte název.')).toBeNull();
  });

  it('Escape drops the edit', async () => {
    const user = userEvent.setup();
    const world = await makeWorld();
    const update = vi.spyOn(world.ports.catalog, 'updateAlbum');
    await open(world);
    await user.click(screen.getByRole('button', { name: 'Přejmenovat album' }));
    await user.type(screen.getByLabelText('Název'), ' navíc');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('heading', { level: 1, name: 'Novákovi' })).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('address (slug)', () => {
  it('warns before anything is written, and writes only after confirmation', async () => {
    const user = userEvent.setup();
    const world = await makeWorld();
    const update = vi.spyOn(world.ports.catalog, 'updateAlbum');
    await open(world);
    const slug = screen.getByLabelText('Adresa');
    await user.clear(slug);
    await user.type(slug, 'novakovi-brno');
    expect(screen.getByText('Změna adresy rozbije stávající odkazy na toto album.')).toBeTruthy();
    await user.tab();
    const dialog = await screen.findByRole('dialog', { name: 'Změnit adresu alba?' });
    expect(dialog.textContent).toContain('Změna adresy rozbije stávající odkazy na toto album.');
    expect(update).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Změnit adresu' }));
    await waitFor(() => expect(dbAlbum(world, 'Novákovi').slug).toBe('novakovi-brno'));
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancelling the warning restores the old address and writes nothing', async () => {
    const user = userEvent.setup();
    const world = await makeWorld();
    const update = vi.spyOn(world.ports.catalog, 'updateAlbum');
    await open(world);
    const slug = screen.getByLabelText('Adresa');
    await user.clear(slug);
    await user.type(slug, 'jina-adresa');
    await user.tab();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Vrátit původní adresu' }));
    expect((screen.getByLabelText('Adresa') as HTMLInputElement).value).toBe('novakovi');
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses an address another album has and offers a free one', async () => {
    const user = userEvent.setup();
    const world = await makeWorld();
    const update = vi.spyOn(world.ports.catalog, 'updateAlbum');
    await open(world);
    const slug = screen.getByLabelText('Adresa');
    await user.clear(slug);
    await user.type(slug, 'dvorakovi');
    await user.tab();
    expect(await screen.findByText('Adresa je už použitá jiným albem.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Adresa'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(update).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Použít adresu dvorakovi-2' }));
    expect((screen.getByLabelText('Adresa') as HTMLInputElement).value).toBe('dvorakovi-2');
    await user.click(await screen.findByRole('button', { name: 'Změnit adresu' }));
    await waitFor(() => expect(dbAlbum(world, 'Novákovi').slug).toBe('dvorakovi-2'));
  });

  it('a clash found only by the server (another tab took the address) shows the same message and suggestion', async () => {
    const user = userEvent.setup();
    const world = await makeWorld();
    await open(world);
    // Created after this page loaded its album list.
    await world.ports.catalog.createAlbum({ category_id: dbCategory(world, 'Portréty').id, slug: 'volna', title: 'Nové jinde' });
    const slug = screen.getByLabelText('Adresa');
    await user.clear(slug);
    await user.type(slug, 'volna');
    await user.tab();
    await user.click(await screen.findByRole('button', { name: 'Změnit adresu' }));
    expect(await screen.findByText('Adresa je už použitá jiným albem.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Použít adresu volna-2' })).toBeTruthy();
    expect(dbAlbum(world, 'Novákovi').slug).toBe('novakovi');
  });

  it('refuses an invalid address without a write', async () => {
    const user = userEvent.setup();
    const world = await makeWorld();
    const update = vi.spyOn(world.ports.catalog, 'updateAlbum');
    await open(world);
    const slug = screen.getByLabelText('Adresa');
    await user.clear(slug);
    await user.type(slug, 'Špatná adresa');
    await user.tab();
    expect(await screen.findByText(cs.album.slugInvalid)).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('search engine texts (docs/SEO.md limits)', () => {
  it('accepts 65 and 160 characters and refuses one more', async () => {
    const user = userEvent.setup();
    const world = await makeWorld();
    const update = vi.spyOn(world.ports.catalog, 'updateAlbum');
    await open(world);
    await user.click(screen.getByText('Pro vyhledávače'));
    const title = screen.getByLabelText('SEO titulek');
    const description = screen.getByLabelText('SEO popis');

    await user.click(title);
    await user.paste('x'.repeat(66));
    await user.tab();
    expect(await screen.findByText('SEO titulek může mít nejvýše 65 znaků.')).toBeTruthy();
    expect(update).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('SEO titulek'));
    await user.paste('y'.repeat(65));
    await user.tab();
    await waitFor(() => expect(dbAlbum(world, 'Novákovi').seo_title).toBe('y'.repeat(65)));

    await user.click(description);
    await user.paste('z'.repeat(161));
    await user.tab();
    expect(await screen.findByText('SEO popis může mít nejvýše 160 znaků.')).toBeTruthy();

    await user.clear(screen.getByLabelText('SEO popis'));
    await user.paste('z'.repeat(160));
    await user.tab();
    await waitFor(() => expect(dbAlbum(world, 'Novákovi').seo_description).toBe('z'.repeat(160)));
  });

  it('shows the character count against the limit', async () => {
    const user = userEvent.setup();
    const world = await makeWorld();
    await open(world);
    await user.click(screen.getByText('Pro vyhledávače'));
    await user.type(screen.getByLabelText('SEO titulek'), 'Svatba');
    expect(screen.getByText(/6 z 65 znaků/)).toBeTruthy();
  });
});

describe('accessibility', () => {
  it('has no serious axe violations: panel, rename, slug warning and error', async () => {
    const user = userEvent.setup();
    const world = await makeWorld();
    await open(world);
    const run = () =>
      axe.run(document.body, {
        runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
        rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
      });
    const bad = (r: Awaited<ReturnType<typeof run>>) =>
      r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.html}`);
    expect(bad(await run())).toEqual([]);
    await user.click(screen.getByText('Pro vyhledávače'));
    await user.click(screen.getByRole('button', { name: 'Přejmenovat album' }));
    await user.clear(screen.getByLabelText('Název'));
    await user.tab();
    await screen.findByText('Vyplňte název.');
    expect(bad(await run())).toEqual([]);
    await user.type(screen.getByLabelText('Název'), 'Zpět{Enter}');
    const slug = screen.getByLabelText('Adresa');
    await user.clear(slug);
    await user.type(slug, 'dvorakovi');
    await user.tab();
    await screen.findByText('Adresa je už použitá jiným albem.');
    expect(bad(await run())).toEqual([]);
    await user.clear(screen.getByLabelText('Adresa'));
    await user.type(screen.getByLabelText('Adresa'), 'nova-adresa');
    await user.tab();
    await screen.findByRole('dialog');
    expect(bad(await run())).toEqual([]);
  });
});
