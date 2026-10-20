/**
 * The tile and preview URLs must come from the shared key helper: with webpKey replaced, a URL that was built
 * by hand (`photos/<id>/480.webp`) no longer matches and this test fails.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AlbumRow, PhotoRow } from '@mp/shared';

vi.mock('@mp/shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('@mp/shared')>();
  return { ...original, webpKey: (id: string, tier: number) => `photos/${id}/via-helper-${tier}.webp` };
});

import { createFakeWorld, fixtureSnapshot } from '../adapters/fake';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { cs } from '../i18n/cs';

afterEach(() => vi.restoreAllMocks());

describe('image URLs come from the key helper', () => {
  it('uses it for the grid tiles (480) and the detail preview (1600)', async () => {
    const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
    const photos = world.snapshot().photos as PhotoRow[];
    const album = (world.snapshot().albums as AlbumRow[]).find((a) => photos.some((p) => p.album_id === a.id))!;
    const photo = photos.find((p) => p.album_id === album.id)!;

    const grid = render(
      <AppProviders ports={world.ports} retry={false} imgBaseUrl="https://img.test">
        <MemoryRouter initialEntries={[`/alba/${album.id}`]}>
          <App />
        </MemoryRouter>
      </AppProviders>,
    );
    const list = await screen.findByRole('list', { name: cs.photos.gridLabel });
    const img = list.querySelector(`[data-photo-id="${photo.id}"] img`)!;
    expect(img.getAttribute('src')).toBe(`https://img.test/photos/${photo.id}/via-helper-480.webp`);
    grid.unmount();

    render(
      <AppProviders ports={world.ports} retry={false} imgBaseUrl="https://img.test">
        <MemoryRouter initialEntries={[`/alba/${album.id}/foto/${photo.id}`]}>
          <App />
        </MemoryRouter>
      </AppProviders>,
    );
    const preview = await screen.findByRole('heading', { level: 1, name: /^Fotka 1 z / });
    expect(preview).toBeTruthy();
    const big = document.querySelector('.photo-preview img')!;
    expect(big.getAttribute('src')).toBe(`https://img.test/photos/${photo.id}/via-helper-1600.webp`);
  });
});
