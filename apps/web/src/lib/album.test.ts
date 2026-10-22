import { SnapshotSchema } from '@mp/shared';
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../../../packages/shared/fixtures/snapshot.fixture.json';
import { FEW_PHOTOS, albumThumbs, aspectOf, formatShotOn, gridSizes, layoutCheckPhotos, rowRemFor, ROW_REM } from './album';

const fixture = SnapshotSchema.parse(fixtureJson);

describe('formatShotOn', () => {
  it('formats in Czech and tolerates null', () => {
    expect(formatShotOn('2023-06-17')).toBe('17. června 2023');
    expect(formatShotOn(null)).toBeNull();
    expect(formatShotOn('nonsense')).toBeNull();
  });
});

describe('justified grid helpers', () => {
  const pool = fixture.categories.flatMap((c) => c.albums.flatMap((a) => a.photos));

  it('uses taller rows for short albums only', () => {
    expect(rowRemFor(FEW_PHOTOS - 1)).toBe(ROW_REM.few);
    expect(rowRemFor(FEW_PHOTOS)).toBe(ROW_REM.regular);
    expect(ROW_REM.few.lg).toBeGreaterThan(ROW_REM.regular.lg);
  });

  it('rounds the aspect ratio and builds a sizes list with three steps and no pixel units', () => {
    expect(aspectOf({ width: 1600, height: 1067 })).toBe(1.5);
    const sizes = gridSizes(1.5, 60);
    expect(sizes).toMatch(/^\(min-width: 64rem\) min\(.+\), \(min-width: 40rem\) [\d.]+rem, min\(.+\)$/);
    expect(sizes).not.toMatch(/px/);
    // Lazy tiles start with `auto` and keep the estimate as fallback.
    expect(gridSizes(1.5, 60, true)).toBe(`auto, ${sizes}`);
    // A wider photo asks for a wider tile.
    expect(gridSizes(2, 60)).not.toBe(gridSizes(0.7, 60));
  });

  it('picks distinct photos for the layout fixtures, mixing orientation in short albums', () => {
    for (const n of [5, 9, 60, 120]) {
      const photos = layoutCheckPhotos(pool, n);
      expect(photos).toHaveLength(n);
      expect(new Set(photos.map((p) => p.id)).size).toBe(n);
    }
    const few = layoutCheckPhotos(pool, 9);
    expect(few.some((p) => p.width >= p.height)).toBe(true);
    expect(few.some((p) => p.width < p.height)).toBe(true);
  });
});

describe('albumThumbs', () => {
  it('numbers the alt text, makes only the first photo eager (high priority) and the rest lazy', () => {
    const category = fixture.categories.find((c) => c.slug === 'svatby')!;
    const album = category.albums.find((a) => a.slug === 'sedlakovi')!;
    const thumbs = albumThumbs(category, album);
    expect(thumbs).toHaveLength(44);
    expect(thumbs.map((t) => t.eager)).toEqual(thumbs.map((_, i) => i === 0));
    expect(thumbs[0]!.priority).toBe(true);
    expect(thumbs.filter((t) => t.priority)).toHaveLength(1);
    expect(thumbs[11]!.alt).toMatch(/fotografie 12 z 44$/);
  });
});
