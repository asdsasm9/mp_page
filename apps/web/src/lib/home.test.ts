import { SnapshotSchema, type Snapshot } from '@mp/shared';
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../../../packages/shared/fixtures/snapshot.fixture.json';
import { REVIEWS } from '../content/reviews';
import { buildCatalog } from './catalog';
import { homeCategoryCards, homeHero, homeReviews } from './home';
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

  it('category cards carry no album count (T-315)', () => {
    const cards = homeCategoryCards(buildCatalog(fixture));
    expect(cards).toHaveLength(3);
    for (const c of cards) expect(c).not.toHaveProperty('countLabel');
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

  it('hero: the chosen photo with its own alt or the fallback text and its og.jpg; none chosen gives null', () => {
    const catalog = buildCatalog(fixture);
    const hero = homeHero(catalog, 'Záložní popis', 'https://img.example.cz/')!;
    expect(hero.photo.id).toBe(fixture.heroPhotoId);
    expect(hero.alt).toBe('Záložní popis');
    expect(hero.og.url).toBe(`https://img.example.cz/photos/${hero.photo.id}/og.jpg`);
    expect(hero.og).toMatchObject({ width: hero.photo.variants.og.w, height: hero.photo.variants.og.h });

    const withAlt: Snapshot = JSON.parse(JSON.stringify(fixture)) as Snapshot;
    for (const c of withAlt.categories) for (const a of c.albums) for (const p of a.photos) if (p.id === fixture.heroPhotoId) p.alt = ' Nevěsta u okna ';
    expect(homeHero(buildCatalog(withAlt), 'x', 'https://img.example.cz')!.alt).toBe('Nevěsta u okna');

    expect(homeHero(buildCatalog({ ...fixture, heroPhotoId: null }), 'x', 'https://img.example.cz')).toBeNull();
  });

  it('hero: a chosen small-master photo is served from its own tiers, never an assumed 2400', () => {
    const snap: Snapshot = JSON.parse(JSON.stringify(fixture)) as Snapshot;
    for (const c of snap.categories) for (const a of c.albums) for (const p of a.photos) {
      if (p.id !== fixture.heroPhotoId) continue;
      p.variants = {
        master: { w: 900, h: 600, bytes: 90_000 },
        webp: [{ tier: 480, w: 480, h: 320, bytes: 20_000 }, { tier: 720, w: 720, h: 480, bytes: 30_000 }],
        jpeg: { w: 900, h: 600, bytes: 60_000 },
        og: { w: 1200, h: 630, bytes: 100_000 },
      };
    }
    const hero = homeHero(buildCatalog(SnapshotSchema.parse(snap)), 'x', 'https://img.example.cz')!;
    const src = photoSources(hero.photo, 'https://img.example.cz');
    expect(src.webpSrcset).not.toMatch(/960w|1600w|2400w/);
    expect(src.webp.map((e) => e.width)).toEqual([480, 720]);
  });

  it('lists pati and anez with the category name of their album', () => {
    const catalog = buildCatalog(fixture);
    const out = homeReviews(catalog, REVIEWS);
    expect(out.map((r) => r.review.albumId)).toEqual(['pati', 'anez']);
    for (const r of out) {
      expect(r.categoryName).toBe(catalog.albumBySlug.get(r.review.albumId)!.category.name);
    }
  });

  it('keeps a review whose album is gone from the snapshot, without a category name and without a photo', () => {
    const out = homeReviews(buildCatalog(without('anez')), REVIEWS);
    expect(out.map((r) => r.review.albumId)).toEqual(['pati', 'anez']);
    expect(out[1]!.categoryName).toBeNull();
    expect(out[1]!.photo).toBeNull();
  });

  it('T-333: the author portrait is the cover of the review album', () => {
    const catalog = buildCatalog(fixture);
    for (const r of homeReviews(catalog, REVIEWS)) {
      expect(r.photo).toEqual(catalog.coverOf(catalog.albumBySlug.get(r.review.albumId)!.album));
    }
  });

  it('shows no reviews when there are none', () => {
    expect(homeReviews(buildCatalog(fixture), [])).toEqual([]);
  });
});
