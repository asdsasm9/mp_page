import { SnapshotSchema, type Snapshot } from '@mp/shared';
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../../../packages/shared/fixtures/snapshot.fixture.json';
import { buildCatalog } from './catalog';
import { FIRST_ROW, categoryCards, categoryPaths } from './category';

const fixture: Snapshot = SnapshotSchema.parse(fixtureJson);
const catalog = buildCatalog(fixture);
const cards = (slug: string) => categoryCards(catalog, catalog.categoryBySlug.get(slug)!);

describe('category data', () => {
  it('has a page for each fixture category', () => {
    expect(categoryPaths(catalog)).toEqual(['svatby', 'portrety', 'parove-foceni']);
  });

  it('lists 4, 6 and 3 albums in snapshot order', () => {
    for (const [slug, n] of [['svatby', 4], ['portrety', 6], ['parove-foceni', 3]] as const) {
      const list = cards(slug);
      expect(list).toHaveLength(n);
      expect(list.map((c) => c.slug)).toEqual(catalog.categoryBySlug.get(slug)!.albums.map((a) => a.slug));
      for (const c of list) expect(c.path).toBe(`/${slug}/${c.slug}/`);
    }
  });

  it('makes the first row eager, only the first card high priority, the rest lazy', () => {
    const list = cards('portrety');
    expect(list.filter((c) => c.eager)).toHaveLength(FIRST_ROW);
    expect(list.filter((c) => c.priority).map((c) => c.slug)).toEqual([list[0]!.slug]);
    expect(list.slice(FIRST_ROW).some((c) => c.eager || c.priority)).toBe(false);
  });

  it('shows the cover and carries no count (T-315)', () => {
    const wedding = catalog.categoryBySlug.get('svatby')!.albums[0]!;
    const first = cards('svatby')[0]!;
    expect(first.photo.id).toBe(catalog.coverOf(wedding)!.id);
    expect(first).not.toHaveProperty('countLabel');
  });

  it('builds no page for a category without published albums (hidden categories are dropped from the snapshot)', () => {
    const hidden: Snapshot = {
      ...fixture,
      categories: fixture.categories.map((c) => (c.slug === 'portrety' ? { ...c, albums: [] } : c)),
    };
    expect(categoryPaths(buildCatalog(hidden))).toEqual(['svatby', 'parove-foceni']);
  });
});
