/** Shared helpers of the accessibility audit tests (WP5-27). Test support only; not imported by the app. */
import { type PhotoRow, type AlbumRow, type CategoryRow } from '@mp/shared';
import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { expect } from 'vitest';
import { createFakeWorld, fixtureSnapshot, type FakeWorld, type FakeWorldOptions } from '../adapters/fake';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import type { Encoder } from '../upload/types';

type User = { tab(options?: { shift?: boolean }): Promise<void> };

export const IMG_BASE = 'https://img.example.test';

export function makeWorld(options: FakeWorldOptions = {}): FakeWorld {
  return createFakeWorld({ signedIn: true, seed: fixtureSnapshot(), ...options });
}

/** Mounts the whole app at a path. */
export function mount(world: FakeWorld, path: string, encoder?: Encoder) {
  return render(
    <AppProviders ports={world.ports} retry={false} imgBaseUrl={IMG_BASE} siteUrl="https://site.example.test" {...(encoder ? { encoder } : {})}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AppProviders>,
  );
}

export interface Fixture {
  category: CategoryRow;
  album: AlbumRow;
  photos: PhotoRow[];
}

/** The category and album of the seed that has the most photos (at least 3), and that album's photos in order. */
export function pickFixture(world: FakeWorld): Fixture {
  const snapshot = world.snapshot();
  const photos = snapshot.photos as PhotoRow[];
  const albums = snapshot.albums as AlbumRow[];
  const counts = new Map<string, number>();
  for (const p of photos) counts.set(p.album_id, (counts.get(p.album_id) ?? 0) + 1);
  const album = [...albums].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))[0]!;
  const category = (snapshot.categories as CategoryRow[]).find((c) => c.id === album.category_id)!;
  expect(counts.get(album.id) ?? 0).toBeGreaterThanOrEqual(3);
  return { category, album, photos: photos.filter((p) => p.album_id === album.id) };
}

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Serious and critical axe findings of the document (colour contrast needs real layout and is checked in the browser). */
export async function seriousViolations(root: Element = document.body): Promise<string[]> {
  const result = await axe.run(root, {
    runOnly: TAGS,
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes[0]?.html ?? ''}`);
}

/** Presses Tab until `target` has focus; fails when it is not reachable within `max` presses. */
export async function tabTo(user: User, target: HTMLElement, max = 250): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (document.activeElement === target) return;
    await user.tab();
  }
  if (document.activeElement !== target) {
    throw new Error(`Not reachable with Tab within ${max} presses: ${target.outerHTML.slice(0, 120)}`);
  }
}

export const heading1 = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name });
