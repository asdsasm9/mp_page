import axe from 'axe-core';
import { PROVIDER_MAX_BYTES, sumBytes, type Snapshot } from '@mp/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeWorld, exampleVariants, fixtureSnapshot, type FakeWorld } from '../adapters/fake';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { buildPhotoList, formatShare, pageOf, PAGE_SIZE, variantParts } from '../data/storageList';
import { cs } from '../i18n/cs';
import { formatBytes } from '../i18n/format';

afterEach(cleanup);

const t = cs.storageScreen;
const EXTRA = 600;

/** The fixture plus 600 more photos in its first album: mixed sizes, every fifth one low resolution. */
function bigSnapshot(): Snapshot {
  const snapshot = fixtureSnapshot();
  const album = snapshot.categories.flatMap((c) => c.albums)[0]!;
  for (let i = 0; i < EXTRA; i += 1) {
    const w = i % 5 === 0 ? 1400 : 2000 + (i % 7) * 200;
    const h = Math.round(w * 0.66);
    album.photos.push({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      width: w,
      height: h,
      alt: null,
      caption: null,
      dominantColor: null,
      variants: exampleVariants(w, h),
    });
  }
  return snapshot;
}

async function open(world: FakeWorld) {
  const view = render(
    <AppProviders ports={world.ports} retry={false}>
      <MemoryRouter initialEntries={['/ulozeni']}>
        <App />
      </MemoryRouter>
    </AppProviders>,
  );
  await screen.findByRole('heading', { level: 1, name: cs.routes.storage.title });
  await screen.findByRole('table', { name: t.photosCaption }, { timeout: 15_000 });
  return view;
}

const list = () => screen.getByRole('table', { name: t.photosCaption });
const bodyRows = () => within(list()).getAllByRole('row').slice(1);
const firstCell = (row: HTMLElement) => within(row).getAllByRole('rowheader')[0]!.textContent;

describe('storageList helpers', () => {
  it('shares of the 10 GB limit are readable and never 0 for a stored photo', () => {
    expect(formatShare(0)).toBe('0 %');
    expect(formatShare(0.001)).toBe('< 0,01 %');
    expect(formatShare((3_300_000 / PROVIDER_MAX_BYTES) * 100)).toBe('0,03 %');
    expect(formatShare(2.46)).toBe('2,5 %');
    expect(formatShare(42.4)).toBe('42 %');
  });

  it('pageOf clamps the page and reports the shown range', () => {
    const rows = Array.from({ length: 60 }, (_, i) => i);
    expect(pageOf(rows, 0)).toMatchObject({ pages: 3, from: 1, to: PAGE_SIZE, total: 60 });
    expect(pageOf(rows, 99)).toMatchObject({ page: 2, from: 51, to: 60 });
    expect(pageOf([], 0)).toMatchObject({ pages: 1, from: 0, to: 0, total: 0 });
  });

  it('the parts of a photo add up to its stored size', () => {
    const v = exampleVariants(3000, 2000);
    expect(variantParts(v).reduce((n, p) => n + p.bytes, 0)).toBe(sumBytes(v));
    expect(variantParts(v).map((p) => p.key)).toEqual(['master', 'webp-480', 'webp-720', 'webp-960', 'webp-1600', 'webp-2400', 'jpeg', 'og']);
  });
});

describe('storage screen: photo list', () => {
  it('600 photos in the catalog show at most one page of rows, biggest first', async () => {
    const world = createFakeWorld({ signedIn: true, seed: bigSnapshot() });
    await open(world);
    const total = world.snapshot().photos.length;
    expect(total).toBeGreaterThan(EXTRA);

    const rows = bodyRows();
    expect(rows.length).toBeLessThanOrEqual(PAGE_SIZE);
    expect(rows).toHaveLength(PAGE_SIZE);
    expect(screen.getByText(`Zobrazeno 1 až ${PAGE_SIZE} z ${total}`)).toBeTruthy();

    // Sorted by stored size, largest first (the "Celková velikost" column is the fourth cell).
    const sizes = world
      .snapshot()
      .photos.map((p) => (p as { bytes_total: number }).bytes_total)
      .sort((a, b) => b - a)
      .slice(0, PAGE_SIZE)
      .map(formatBytes);
    expect(rows.map((r) => within(r).getAllByRole('cell')[2]!.textContent)).toEqual(sizes);

    const user = userEvent.setup();
    const first = firstCell(rows[0]!);
    await user.click(screen.getByRole('button', { name: t.pageNext }));
    expect(bodyRows()).toHaveLength(PAGE_SIZE);
    expect(screen.getByText(`Zobrazeno ${PAGE_SIZE + 1} až ${PAGE_SIZE * 2} z ${total}`)).toBeTruthy();
    expect(screen.getByText(`Strana 2 z ${Math.ceil(total / PAGE_SIZE)}`)).toBeTruthy();
    expect(firstCell(bodyRows()[0]!) === first && within(bodyRows()[0]!).getAllByRole('cell')[2]!.textContent === sizes[0]).toBe(false);

    // The last page is also bounded.
    for (let i = 0; i < Math.ceil(total / PAGE_SIZE); i += 1) await user.click(screen.getByRole('button', { name: t.pageNext }));
    expect(bodyRows().length).toBeLessThanOrEqual(PAGE_SIZE);
    expect(bodyRows().length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.photo-list-table tbody tr').length).toBeLessThanOrEqual(PAGE_SIZE);
  });

  it('filters by album and returns to the first page', async () => {
    const world = createFakeWorld({ signedIn: true, seed: bigSnapshot() });
    await open(world);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: t.pageNext }));

    const select = screen.getByRole('combobox', { name: t.filterLabel });
    const options = within(select).getAllByRole('option');
    expect(options[0]!.textContent).toBe(t.filterAll);
    expect(options.length).toBeGreaterThan(2);

    const albums = world.snapshot().albums as { id: string; title: string }[];
    const small = albums.find((a) => a.title === options.at(-1)!.textContent)!;
    const count = world.snapshot().photos.filter((p) => (p as { album_id: string }).album_id === small.id).length;
    await user.selectOptions(select, small.id);

    const rows = bodyRows();
    expect(rows).toHaveLength(Math.min(count, PAGE_SIZE));
    expect(screen.getByText(new RegExp(`^Zobrazeno 1 až ${Math.min(count, PAGE_SIZE)} z ${count}$`))).toBeTruthy();
    for (const row of rows) expect(within(row).getAllByRole('cell')[0]!.textContent).toBe(small.title);
  });

  it('shows the verdict, the share of 10 GB and the per-variant breakdown that adds up', async () => {
    const world = createFakeWorld({ signedIn: true, seed: bigSnapshot() });
    await open(world);
    const user = userEvent.setup();
    const filter = screen.getByRole('combobox', { name: t.filterLabel });
    const albums = world.snapshot().albums as { id: string }[];
    const photos = world.snapshot().photos as { album_id: string; id: string; bytes_total: number; variants: ReturnType<typeof exampleVariants> }[];
    const big = albums.find((a) => photos.filter((p) => p.album_id === a.id).length > EXTRA)!;
    await user.selectOptions(filter, big.id);

    const row = bodyRows()[0]!;
    const cells = within(row).getAllByRole('cell');
    const top = buildPhotoList(
      [{ id: big.id, title: cells[0]!.textContent! } as never],
      new Map([[big.id, photos.filter((p) => p.album_id === big.id) as never]]),
      null,
    )[0]!;
    expect(cells[2]!.textContent).toBe(formatBytes(top.bytes));
    expect(cells[3]!.textContent).toBe(formatShare((top.bytes / PROVIDER_MAX_BYTES) * 100));
    expect(within(cells[4]!).getByText(cs.quality.verdict.good)).toBeTruthy();

    const details = within(cells[5]!).getByText(t.partsSummary).closest('details')!;
    await user.click(within(details).getByText(t.partsSummary));
    expect(details.open).toBe(true);
    const parts = within(details).getAllByRole('listitem');
    expect(parts).toHaveLength(top.parts.length);
    expect(parts[0]!.textContent).toContain(t.partMaster);
    expect(parts.some((p) => p.textContent!.includes('WebP 480 px'))).toBe(true);
    expect(top.parts.reduce((n, p) => n + p.bytes, 0)).toBe(top.bytes);

    // The smallest photos come last: low resolution gets the shared "Nízké rozlišení" badge, the others stay "Dobré".
    const pages = Math.ceil(photos.filter((p) => p.album_id === big.id).length / PAGE_SIZE);
    for (let i = 0; i < pages; i += 1) await user.click(screen.getByRole('button', { name: t.pageNext }));
    const lastRows = bodyRows();
    expect(within(lastRows.at(-1)!).getByText(cs.quality.verdict.low)).toBeTruthy();
    expect(within(lastRows.at(-1)!).queryByText(cs.quality.verdict.good)).toBeNull();
  });

  it('has no accessibility violations', async () => {
    const world = createFakeWorld({ signedIn: true, seed: bigSnapshot() });
    const view = await open(world);
    const result = await axe.run(view.container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(' | ')}`)).toEqual([]);
  });
});
