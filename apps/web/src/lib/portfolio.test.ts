import { SnapshotSchema, type Snapshot } from '@mp/shared';
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../../../packages/shared/fixtures/snapshot.fixture.json';
import { buildCatalog } from './catalog';
import { PORTFOLIO_ALBUMS, portfolioCards, portfolioPicks } from './portfolio';

const fixture: Snapshot = SnapshotSchema.parse(fixtureJson);
const catalog = buildCatalog(fixture);

describe('portfolio selection', () => {
  it('puts the first album of every category first, then the others in catalog order', () => {
    const picks = portfolioPicks(catalog);
    expect(picks).toHaveLength(PORTFOLIO_ALBUMS);
    const firsts = catalog.categories.map((c) => c.albums[0]!.slug);
    expect(picks.slice(0, 3).map((p) => p.album.slug)).toEqual(firsts);
    const rest = catalog.categories.flatMap((c) => c.albums.slice(1)).map((a) => a.slug);
    expect(picks.slice(3).map((p) => p.album.slug)).toEqual(rest.slice(0, PORTFOLIO_ALBUMS - 3));
  });

  it('respects max and has no duplicates', () => {
    expect(portfolioPicks(catalog, 2)).toHaveLength(2);
    const slugs = portfolioPicks(catalog, 100).map((p) => p.album.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toHaveLength(13);
  });

  it('builds lazy cards with album paths', () => {
    const cards = portfolioCards(catalog);
    expect(cards).toHaveLength(PORTFOLIO_ALBUMS);
    expect(cards.some((c) => c.eager || c.priority)).toBe(false);
    for (const [i, pick] of portfolioPicks(catalog).entries()) {
      expect(cards[i]!.path).toBe(`/${pick.category.slug}/${pick.album.slug}/`);
    }
  });
});
