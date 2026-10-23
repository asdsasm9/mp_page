import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { AlbumRow, PhotoRow } from '@mp/shared';
import { createFakeWorld, exampleVariants, fixtureSnapshot, withQualityExamples } from '../adapters/fake';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { PhotoQualityFacts } from '../components/PhotoQualityFacts';
import { QualityBadge } from '../components/QualityBadge';
import { cs } from '../i18n/cs';
import { badgeVerdicts, photoQuality, summarizeQuality } from './photoQuality';

afterEach(cleanup);

const row = (w: number, h: number, skip: number[] = []) => ({ width: w, height: h, variants: exampleVariants(w, h, { skipTiers: skip }) });

describe('photoQuality', () => {
  it('low, good, missing and portrait examples', () => {
    expect(photoQuality(row(1480, 987)).verdict).toBe('low');
    expect(photoQuality(row(3000, 2000)).verdict).toBe('good');
    const missing = photoQuality(row(3000, 2000, [720]));
    expect(missing.verdict).toBe('missing');
    expect(missing.missing).toEqual(['webp720']);
    expect(photoQuality(row(1500, 2250)).verdict).toBe('good');
  });

  it('reports master size, bytes and the tier list', () => {
    const q = photoQuality(row(3000, 2000));
    expect(q.width).toBe(3000);
    expect(q.masterBytes).toBeGreaterThan(q.overviewBytes);
    expect(q.overviewBytes).toBeGreaterThan(0);
    expect(q.tiers).toEqual(['480', '720', '960', '1600', '2400', 'JPEG', 'OG']);
  });

  it('a small photo with a missing tier is still counted as low resolution', () => {
    const q = photoQuality(row(1480, 987, [720]));
    expect(q.verdict).toBe('missing');
    expect(q.low).toBe(true);
    expect(badgeVerdicts(q)).toEqual(['low', 'missing']);
    expect(badgeVerdicts(photoQuality(row(3000, 2000)))).toEqual(['good']);
  });

  it('summarises the low-resolution count', () => {
    expect(summarizeQuality([row(1480, 987), row(3000, 2000), row(1500, 2250)])).toEqual({ total: 3, low: 1 });
  });
});

describe('badge and facts', () => {
  it('shows the Czech label with an icon that is hidden from assistive tech', () => {
    for (const [verdict, label] of [
      ['low', 'Nízké rozlišení'],
      ['good', 'Dobré'],
      ['missing', 'Chybí varianta'],
    ] as const) {
      const { container, unmount } = render(<QualityBadge verdict={verdict} />);
      expect(screen.getByText(label)).toBeTruthy();
      expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
      unmount();
    }
  });

  it('facts list pixel size, file sizes and tiers', () => {
    render(<PhotoQualityFacts photo={row(3000, 2000, [720])} />);
    expect(screen.getByText('3000 × 2000 px')).toBeTruthy();
    expect(screen.getByText('Chybí varianta')).toBeTruthy();
    expect(screen.getByText('Chybí: webp720')).toBeTruthy();
    expect(screen.getByText(/480 px, 960 px, 1600 px, 2400 px, JPEG, OG/)).toBeTruthy();
  });
});

describe('album gallery', () => {
  it('shows the summary line and the low-resolution filter', async () => {
    const world = createFakeWorld({ signedIn: true, seed: withQualityExamples(fixtureSnapshot()) });
    const photos = world.snapshot().photos as PhotoRow[];
    const albums = world.snapshot().albums as AlbumRow[];
    const example = photos.find((p) => p.width === 3000 && !p.variants.webp.some((e) => e.tier === 720))!;
    const album = albums.find((a) => a.id === example.album_id)!;
    const rows = photos.filter((p) => p.album_id === album.id);
    const low = rows.filter((p) => Math.max(p.width, p.height) < 2000).length;
    const user = userEvent.setup();
    render(
      <AppProviders ports={world.ports} retry={false} imgBaseUrl="https://img.test">
        <MemoryRouter initialEntries={[`/alba/${album.id}`]}>
          <App />
        </MemoryRouter>
      </AppProviders>,
    );
    const grid = await screen.findByRole('list', { name: cs.photos.gridLabel });
    expect(screen.getByText(`${low} z ${rows.length} fotek je v nízkém rozlišení`)).toBeTruthy();
    expect(within(grid).getAllByRole('listitem')).toHaveLength(rows.length);
    expect(within(grid).getAllByText('Nízké rozlišení')).toHaveLength(low);
    expect(within(grid).getAllByText('Chybí varianta')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Jen nízké rozlišení' }));
    expect(within(grid).getAllByRole('listitem')).toHaveLength(low);
    expect(screen.getByRole('button', { name: 'Jen nízké rozlišení' }).getAttribute('aria-pressed')).toBe('true');
  });
});
