import { SnapshotSchema, type Snapshot } from '@mp/shared';
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../../../packages/shared/fixtures/snapshot.fixture.json';
import { REVIEWS } from '../content/reviews';
import { buildCatalog } from './catalog';
import { homeCategoryCards, homeReviews } from './home';

const fixture: Snapshot = SnapshotSchema.parse(fixtureJson);

function without(slug: string): Snapshot {
  return {
    ...fixture,
    categories: fixture.categories.map((c) => ({ ...c, albums: c.albums.filter((a) => a.slug !== slug) })),
  };
}

describe('home data', () => {
  it('has one card per category with the first album cover', () => {
    const catalog = buildCatalog(fixture);
    const cards = homeCategoryCards(catalog);
    expect(cards.map((c) => c.path)).toEqual(['/svatby/', '/portrety/', '/parove-foceni/']);
    for (const card of cards) {
      const cat = catalog.categoryBySlug.get(card.slug)!;
      expect(card.photo.id).toBe(catalog.coverOf(cat.albums[0]!)!.id);
      expect(card.name.length).toBeGreaterThan(0);
    }
  });

  it('shows the covers of pati and anez next to the reviews', () => {
    const catalog = buildCatalog(fixture);
    const out = homeReviews(catalog, REVIEWS);
    expect(out.map((r) => r.review.albumId)).toEqual(['pati', 'anez']);
    for (const r of out) {
      expect(r.photo.id).toBe(catalog.coverOf(catalog.albumBySlug.get(r.review.albumId)!.album)!.id);
    }
  });

  it('builds without the anez review when the snapshot lacks that album', () => {
    const catalog = buildCatalog(without('anez'));
    const out = homeReviews(catalog, REVIEWS);
    expect(out.map((r) => r.review.albumId)).toEqual(['pati']);
  });

  it('shows no reviews when both albums are missing', () => {
    expect(homeReviews(buildCatalog(without('anez')), REVIEWS.filter((r) => r.albumId === 'anez'))).toEqual([]);
  });
});
