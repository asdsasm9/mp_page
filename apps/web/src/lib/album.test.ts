import { SnapshotSchema } from '@mp/shared';
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../../../packages/shared/fixtures/snapshot.fixture.json';
import { albumThumbs, formatShotOn } from './album';

const fixture = SnapshotSchema.parse(fixtureJson);

describe('formatShotOn', () => {
  it('formats in Czech and tolerates null', () => {
    expect(formatShotOn('2023-06-17')).toBe('17. června 2023');
    expect(formatShotOn(null)).toBeNull();
    expect(formatShotOn('nonsense')).toBeNull();
  });
});

describe('albumThumbs', () => {
  it('numbers the alt text, makes the first row eager and the rest lazy', () => {
    const category = fixture.categories.find((c) => c.slug === 'svatby')!;
    const album = category.albums.find((a) => a.slug === 'sedlakovi')!;
    const thumbs = albumThumbs(category, album);
    expect(thumbs).toHaveLength(44);
    expect(thumbs.map((t) => t.eager)).toEqual(thumbs.map((_, i) => i < 3));
    expect(thumbs.filter((t) => t.priority)).toHaveLength(1);
    expect(thumbs[11]!.alt).toMatch(/fotografie 12 z 44$/);
  });
});
