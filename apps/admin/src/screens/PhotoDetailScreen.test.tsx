import axe from 'axe-core';
import { webpKey, type AlbumRow, type PhotoRow } from '@mp/shared';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorld, fixtureSnapshot, type FakeWorld } from '../adapters/fake';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { cs } from '../i18n/cs';
import { ApiError } from '../ports';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const photosOf = (world: FakeWorld, albumId: string) =>
  (world.snapshot().photos as PhotoRow[]).filter((p) => p.album_id === albumId);
const dbPhoto = (world: FakeWorld, id: string) => (world.snapshot().photos as PhotoRow[]).find((p) => p.id === id)!;

function setup() {
  const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
  const all = world.snapshot().photos as PhotoRow[];
  const album = (world.snapshot().albums as AlbumRow[]).find((a) => all.filter((p) => p.album_id === a.id).length >= 3)!;
  return { world, album, rows: photosOf(world, album.id) };
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

async function open(world: FakeWorld, album: AlbumRow, photo: PhotoRow, n: number, total: number) {
  render(
    <AppProviders ports={world.ports} retry={false} imgBaseUrl="https://img.test">
      <MemoryRouter initialEntries={[`/alba/${album.id}/foto/${photo.id}`]}>
        <App />
        <Where />
      </MemoryRouter>
    </AppProviders>,
  );
  await screen.findByRole('heading', { level: 1, name: `Fotka ${n} z ${total}` });
}

describe('photo detail', () => {
  it('shows the 1600 preview, the texts, the hint and the buttons', async () => {
    const { world, album, rows } = setup();
    await world.ports.catalog.updatePhoto(rows[1]!.id, { alt: 'Nevěsta s kyticí', caption: 'První tanec' });
    await open(world, album, dbPhoto(world, rows[1]!.id), 2, rows.length);
    const img = document.querySelector('.photo-preview img')!;
    expect(img.getAttribute('src')).toBe(`https://img.test/${webpKey(rows[1]!.id, 1600)}`);
    expect(img.getAttribute('width')).toBeTruthy();
    expect(img.getAttribute('height')).toBeTruthy();
    expect(img.getAttribute('alt')).toBe('Nevěsta s kyticí');
    expect((screen.getByLabelText('Alternativní text') as HTMLTextAreaElement).value).toBe('Nevěsta s kyticí');
    expect((screen.getByLabelText('Popisek') as HTMLTextAreaElement).value).toBe('První tanec');
    expect(screen.getByText('Popište, co je na fotce, pro nevidomé a vyhledávače')).toBeTruthy();
    for (const name of ['Uložit', 'Předchozí', 'Další']) expect(screen.getByRole('button', { name })).toBeTruthy();
  });

  it('saves only alt and caption, with updated_at, and says "Uloženo"', async () => {
    const user = userEvent.setup();
    const { world, album, rows } = setup();
    const update = vi.spyOn(world.ports.catalog, 'updatePhoto');
    await open(world, album, rows[0]!, 1, rows.length);
    const alt = screen.getByLabelText('Alternativní text');
    await user.clear(alt);
    await user.type(alt, 'Ženich a nevěsta u oltáře');
    await user.clear(screen.getByLabelText('Popisek'));
    await user.click(screen.getByRole('button', { name: 'Uložit' }));
    await waitFor(() => expect(dbPhoto(world, rows[0]!.id).alt).toBe('Ženich a nevěsta u oltáře'));
    expect(dbPhoto(world, rows[0]!.id).caption).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
    expect(Object.keys(update.mock.calls[0]![1]).sort()).toEqual(['alt', 'caption']);
    expect(update.mock.calls[0]![2]).toEqual({ expectedUpdatedAt: rows[0]!.updated_at });
    expect(await screen.findByText('Uloženo')).toBeTruthy();
  });

  it('refuses an alt text that looks like a file name, without a write', async () => {
    const user = userEvent.setup();
    const { world, album, rows } = setup();
    const update = vi.spyOn(world.ports.catalog, 'updatePhoto');
    await open(world, album, rows[0]!, 1, rows.length);
    const alt = screen.getByLabelText('Alternativní text');
    await user.clear(alt);
    await user.type(alt, 'IMG_0001.jpg');
    await user.click(screen.getByRole('button', { name: 'Uložit' }));
    expect(await screen.findByText(cs.photos.detail.altFilename)).toBeTruthy();
    expect(document.activeElement).toBe(alt);
    expect(alt.getAttribute('aria-invalid')).toBe('true');
    expect(update).not.toHaveBeenCalled();
  });

  it('warns, but still saves, an alt text over 125 characters', async () => {
    const user = userEvent.setup();
    const { world, album, rows } = setup();
    await open(world, album, rows[0]!, 1, rows.length);
    const alt = screen.getByLabelText('Alternativní text');
    await user.clear(alt);
    await user.click(alt);
    await user.paste('x'.repeat(130));
    expect(screen.getByText(/Doporučeno nejvýše 125/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Uložit' }));
    await waitFor(() => expect(dbPhoto(world, rows[0]!.id).alt).toBe('x'.repeat(130)));
  });

  it('a failed save keeps the text, and "changed elsewhere" offers a reload', async () => {
    const user = userEvent.setup();
    const { world, album, rows } = setup();
    await open(world, album, rows[0]!, 1, rows.length);
    const caption = screen.getByLabelText('Popisek');
    await user.clear(caption);
    await user.type(caption, 'Nový popisek');
    world.failNext('catalog.updatePhoto', new ApiError('INTERNAL'));
    await user.click(screen.getByRole('button', { name: 'Uložit' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((caption as HTMLTextAreaElement).value).toBe('Nový popisek');
    // The other device wrote first: the next save is stale.
    await world.ports.catalog.updatePhoto(rows[0]!.id, { caption: 'Jinde' });
    await user.click(screen.getByRole('button', { name: 'Uložit' }));
    expect(await screen.findByText(cs.data.staleSentenceBy.photo)).toBeTruthy();
    expect(dbPhoto(world, rows[0]!.id).caption).toBe('Jinde');
  });

  it('Předchozí / Další walk the album order and are disabled at the ends, with focus moved off', async () => {
    const user = userEvent.setup();
    const { world, album, rows } = setup();
    await open(world, album, rows[0]!, 1, rows.length);
    const previous = screen.getByRole('button', { name: 'Předchozí' }) as HTMLButtonElement;
    const next = screen.getByRole('button', { name: 'Další' }) as HTMLButtonElement;
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    await user.click(next);
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`/alba/${album.id}/foto/${rows[1]!.id}`));
    await screen.findByRole('heading', { level: 1, name: `Fotka 2 z ${rows.length}` });
    await waitFor(() => expect(previous.disabled).toBe(false));
    await waitFor(() =>
      expect((screen.getByLabelText('Alternativní text') as HTMLTextAreaElement).value).toBe(rows[1]!.alt ?? ''),
    );
    await user.click(previous);
    await screen.findByRole('heading', { level: 1, name: `Fotka 1 z ${rows.length}` });
    // Went back to the start: the focused "Předchozí" is now disabled, focus is on "Další".
    await waitFor(() => expect(previous.disabled).toBe(true));
    await waitFor(() => expect(document.activeElement).toBe(next));

    cleanup();
    await open(world, album, rows.at(-2)!, rows.length - 1, rows.length);
    const next2 = screen.getByRole('button', { name: 'Další' }) as HTMLButtonElement;
    await user.click(next2);
    await screen.findByRole('heading', { level: 1, name: `Fotka ${rows.length} z ${rows.length}` });
    await waitFor(() => expect(next2.disabled).toBe(true));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Předchozí' })));
  });

  it('saves an edited draft before Další / Předchozí navigates', async () => {
    const user = userEvent.setup();
    const { world, album, rows } = setup();
    await open(world, album, rows[0]!, 1, rows.length);
    const alt = screen.getByLabelText('Alternativní text');
    await user.type(alt, 'Rozepsaný popis');
    await user.click(screen.getByRole('button', { name: 'Další' }));
    await screen.findByRole('heading', { level: 1, name: `Fotka 2 z ${rows.length}` });
    expect(dbPhoto(world, rows[0]!.id).alt).toBe('Rozepsaný popis');
    expect(screen.getByTestId('where').textContent).toBe(`/alba/${album.id}/foto/${rows[1]!.id}`);
    // Going back shows the saved text.
    await user.click(screen.getByRole('button', { name: 'Předchozí' }));
    await screen.findByRole('heading', { level: 1, name: `Fotka 1 z ${rows.length}` });
    expect((screen.getByLabelText('Alternativní text') as HTMLTextAreaElement).value).toBe('Rozepsaný popis');
  });

  it('an unchanged form navigates without a write', async () => {
    const user = userEvent.setup();
    const { world, album, rows } = setup();
    const update = vi.spyOn(world.ports.catalog, 'updatePhoto');
    await open(world, album, rows[0]!, 1, rows.length);
    await user.click(screen.getByRole('button', { name: 'Další' }));
    await screen.findByRole('heading', { level: 1, name: `Fotka 2 z ${rows.length}` });
    expect(update).not.toHaveBeenCalled();
  });

  it('an invalid draft keeps you on the photo with the error and a note, and writes nothing', async () => {
    const user = userEvent.setup();
    const { world, album, rows } = setup();
    const update = vi.spyOn(world.ports.catalog, 'updatePhoto');
    await open(world, album, rows[0]!, 1, rows.length);
    await user.type(screen.getByLabelText('Alternativní text'), 'IMG_0001.jpg');
    await user.click(screen.getByRole('button', { name: 'Další' }));
    expect(await screen.findByText(cs.photos.detail.altFilename)).toBeTruthy();
    expect(screen.getByText(cs.photos.detail.unsavedBlocked)).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe(`/alba/${album.id}/foto/${rows[0]!.id}`);
    expect(update).not.toHaveBeenCalled();
  });

  it('a failed save of the draft also keeps you on the photo', async () => {
    const user = userEvent.setup();
    const { world, album, rows } = setup();
    await open(world, album, rows[0]!, 1, rows.length);
    await user.type(screen.getByLabelText('Popisek'), 'Něco');
    world.failNext('catalog.updatePhoto', new ApiError('INTERNAL'));
    await user.click(screen.getByRole('button', { name: 'Další' }));
    expect(await screen.findByText(cs.photos.detail.unsavedBlocked)).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe(`/alba/${album.id}/foto/${rows[0]!.id}`);
    expect((screen.getByLabelText('Popisek') as HTMLTextAreaElement).value).toBe('Něco');
  });

  it('sets the cover from the detail', async () => {
    const user = userEvent.setup();
    const { world, album, rows } = setup();
    await world.ports.catalog.updateAlbum(album.id, { cover_photo_id: rows[0]!.id });
    await open(world, album, rows[1]!, 2, rows.length);
    await user.click(screen.getByRole('button', { name: 'Nastavit jako titulní' }));
    expect(await screen.findByText('Titulní fotka nastavena.')).toBeTruthy();
    await waitFor(() =>
      expect((world.snapshot().albums as AlbumRow[]).find((a) => a.id === album.id)!.cover_photo_id).toBe(rows[1]!.id),
    );
    expect(await screen.findByText('Titulní', { selector: '.badge' })).toBeTruthy();
  });

  it('an unknown photo says it was not found', async () => {
    const { world, album } = setup();
    render(
      <AppProviders ports={world.ports} retry={false}>
        <MemoryRouter initialEntries={[`/alba/${album.id}/foto/nope`]}>
          <App />
        </MemoryRouter>
      </AppProviders>,
    );
    expect(await screen.findByText(cs.photos.detail.notFound)).toBeTruthy();
  });

  it('has no serious axe violations, also with an error shown', async () => {
    const user = userEvent.setup();
    const { world, album, rows } = setup();
    await open(world, album, rows[0]!, 1, rows.length);
    const run = () =>
      axe.run(document.body, {
        runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
        rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
      });
    const bad = (r: Awaited<ReturnType<typeof run>>) =>
      r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.html}`);
    expect(bad(await run())).toEqual([]);
    const alt = screen.getByLabelText('Alternativní text');
    await user.clear(alt);
    await user.type(alt, 'foto 1');
    await user.click(screen.getByRole('button', { name: 'Uložit' }));
    await screen.findByText(cs.photos.detail.altGeneric);
    expect(bad(await run())).toEqual([]);
    expect(within(document.body).getByRole('navigation', { name: cs.photos.detail.nav })).toBeTruthy();
  });
});
