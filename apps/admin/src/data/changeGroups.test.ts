import type { ChangeLogRow } from '@mp/shared';
import { describe, expect, it } from 'vitest';
import { CATEGORY_OWN, NONE, groupChanges } from './changeGroups';

let id = 100;
const row = (over: Partial<ChangeLogRow>): ChangeLogRow => ({
  id: id--,
  at: '2026-10-22T10:00:00.000Z',
  table_name: 'photos',
  row_id: `row-${id}`,
  kind: 'edited',
  label: 'x',
  category_id: 'c1',
  category_name: 'Svatby',
  album_id: 'a1',
  album_title: 'Novákovi',
  ...over,
});

describe('groupChanges', () => {
  it('groups by category, then album, keeping newest-first order and the category own lines apart', () => {
    const rows = [
      row({ table_name: 'photos', album_id: 'a2', album_title: 'Studio', category_id: 'c2', category_name: 'Portréty' }),
      row({ table_name: 'categories', category_id: 'c1', album_id: null, album_title: null }),
      row({ table_name: 'photos' }),
      row({ table_name: 'albums' }),
      row({ table_name: 'photos', album_id: 'a3', album_title: 'Jiné' }),
    ];
    const { groups, shown, more } = groupChanges(rows, 10);
    expect([shown, more]).toEqual([5, 0]);
    expect(groups.map((g) => g.name)).toEqual(['Portréty', 'Svatby']);
    expect(groups[1]!.albums.map((a) => [a.key, a.lines.length])).toEqual([
      [CATEGORY_OWN, 1],
      ['a1', 2],
      ['a3', 1],
    ]);
  });

  it('shown + more equals the number of rows; unknown category and album get the none key', () => {
    const rows = Array.from({ length: 7 }, () => row({ category_id: null, category_name: null, album_id: null, album_title: null }));
    const g = groupChanges(rows, 3);
    expect(g.shown + g.more).toBe(7);
    expect(g.more).toBe(4);
    expect(g.groups).toHaveLength(1);
    expect(g.groups[0]!.key).toBe(NONE);
    expect(g.groups[0]!.albums[0]!.key).toBe(NONE);
    expect(groupChanges([], 5)).toEqual({ groups: [], shown: 0, more: 0 });
  });
});
