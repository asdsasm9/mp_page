import { SnapshotSchema, type Snapshot } from '@mp/shared';
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../../../packages/shared/fixtures/snapshot.fixture.json';
import { REVIEWS } from '../content/reviews';
import { buildCatalog } from './catalog';
import { homeCategoryCards, homeReviews } from './home';
import { photoSources } from './images';

const fixture: Snapshot = SnapshotSchema.parse(fixtureJson);

function without(slug: string): Snapshot {
  return {
    ...fixture,
    categories: fixture.categories.map((c) => ({ ...c, albums: c.albums.filter((a) => a.slug !== slug) })),
  };
}

describe('home data', () => {
  it('has one card per category: the chosen photo, else the first album cover', () => {
    const catalog = buildCatalog(fixture);
    const cards = homeCategoryCards(catalog);
    expect(cards.map((c) => c.path)).toEqual(['/svatby/', '/portrety/', '/parove-foceni/']);
    for (const card of cards) {
      const cat = catalog.categoryBySlug.get(card.slug)!;
      const expected = cat.coverPhotoId ?? catalog.coverOf(cat.albums[0]!)!.id;
      expect(card.photo.id).toBe(expected);
      expect(card.name.length).toBeGreaterThan(0);
    }
    // the fixture has one category with a chosen photo and the others automatic
    expect(cards[0]!.photo.id).toBe(fixture.categories[0]!.coverPhotoId);
    expect(cards[1]!.photo.id).toBe(catalog.coverOf(fixture.categories[1]!.albums[0]!)!.id);
  });

  it('a chosen small-master photo is served from its own tiers, never an assumed 1600', () => {
    const snap: Snapshot = JSON.parse(JSON.stringify(fixture)) as Snapshot;
    const cat = snap.categories[0]!;
    const pick = cat.albums[0]!.photos[3]!;
    pick.width = 700;
    pick.height = 467;
    pick.variants = {
      master: { w: 700, h: 467, bytes: 90_000 },
      webp: [{ tier: 480, w: 480, h: 320, bytes: 20_000 }],
      jpeg: { w: 700, h: 467, bytes: 60_000 },
      og: { w: 1200, h: 630, bytes: 100_000 },
    };
    cat.coverPhotoId = pick.id;
    const card = homeCategoryCards(buildCatalog(SnapshotSchema.parse(snap)))[0]!;
    expect(card.photo.id).toBe(pick.id);
    const src = photoSources(card.photo, 'https://img.example.cz');
    expect(src.webpSrcset).toContain('480');
    expect(src.webpSrcset).not.toContain('1600');
    expect(src.fallback.width).toBe(700);
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
