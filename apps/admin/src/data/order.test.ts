import { describe, expect, it } from 'vitest';
import {
  applySortUpdates,
  hasDuplicateSort,
  nextSortAfterLast,
  planMove,
  planMoveToEnd,
  planMoveToPosition,
  planMoveToStart,
  planRenumber,
  planRepair,
  sortedRows,
  type Ordered,
} from './order';

/** Small deterministic PRNG (mulberry32) so a failing case can be replayed from its seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const row = (id: string, sort: number): Ordered => ({ id, sort });
const ids = (rows: readonly Ordered[]) => sortedRows(rows).map((r) => r.id);

function randomRows(next: () => number): Ordered[] {
  const n = 1 + Math.floor(next() * 12);
  // Small number range on purpose: collisions and tight gaps are common.
  const dense = next() < 0.5;
  return Array.from({ length: n }, (_, i) => row(`id-${String(i).padStart(2, '0')}`, Math.floor(next() * (dense ? n * 2 : 1000))));
}

describe('basic moves', () => {
  const rows = [row('a', 10), row('b', 20), row('c', 30), row('d', 40)];

  it('moving into a gap writes one row (the midpoint)', () => {
    expect(planMoveToPosition(rows, 'd', 2)).toEqual([{ id: 'd', sort: 15 }]);
    expect(planMove(rows, 'a', 1)).toEqual([{ id: 'a', sort: 25 }]);
  });

  it('start and end write one row', () => {
    expect(planMoveToStart(rows, 'c')).toEqual([{ id: 'c', sort: 0 }]);
    expect(planMoveToEnd(rows, 'a')).toEqual([{ id: 'a', sort: 50 }]);
  });

  it('same place and the edges of the list write nothing', () => {
    expect(planMoveToPosition(rows, 'b', 2)).toEqual([]);
    expect(planMove(rows, 'a', -1)).toEqual([]);
    expect(planMove(rows, 'd', 1)).toEqual([]);
    expect(planMoveToStart(rows, 'a')).toEqual([]);
    expect(planMoveToEnd(rows, 'd')).toEqual([]);
  });

  it('a single row, an unknown id and a bad position write nothing', () => {
    expect(planMoveToPosition([row('a', 10)], 'a', 1)).toEqual([]);
    expect(planMoveToPosition(rows, 'zzz', 1)).toEqual([]);
    expect(planMoveToPosition(rows, 'a', Number.NaN)).toEqual([]);
  });

  it('clamps the position to the list', () => {
    expect(ids(applySortUpdates(rows, planMoveToPosition(rows, 'a', 99)))).toEqual(['b', 'c', 'd', 'a']);
    expect(ids(applySortUpdates(rows, planMoveToPosition(rows, 'd', -5)))).toEqual(['d', 'a', 'b', 'c']);
  });

  it('an exhausted gap renumbers with step 10, writing only rows that change', () => {
    const tight = [row('a', 1), row('b', 2), row('c', 3), row('d', 4)];
    const updates = planMoveToPosition(tight, 'd', 2);
    expect(updates).toEqual([
      { id: 'a', sort: 10 },
      { id: 'd', sort: 20 },
      { id: 'b', sort: 30 },
      { id: 'c', sort: 40 },
    ]);
    const settled = [row('a', 10), row('b', 20), row('c', 30), row('d', 5)];
    // d moves to position 3: neighbours b (20) and c (30) have room, so only d is written.
    expect(planMoveToPosition(settled, 'd', 3)).toEqual([{ id: 'd', sort: 25 }]);
  });

  it('moving to the start with no room below zero renumbers', () => {
    const rows2 = [row('a', 3), row('b', 4), row('c', 5)];
    expect(planMoveToStart(rows2, 'c')).toEqual([
      { id: 'c', sort: 10 },
      { id: 'a', sort: 20 },
      { id: 'b', sort: 30 },
    ]);
  });
});

describe('duplicate sort values', () => {
  it('are ordered by id', () => {
    expect(ids([row('b', 10), row('a', 10), row('c', 5)])).toEqual(['c', 'a', 'b']);
  });

  it('a move between equal neighbours renumbers and the result is unambiguous', () => {
    const rows = [row('a', 10), row('b', 10), row('c', 10)];
    const updates = planMoveToPosition(rows, 'c', 2);
    expect(updates).toEqual([
      { id: 'c', sort: 20 },
      { id: 'b', sort: 30 },
    ]);
    const after = applySortUpdates(rows, updates);
    expect(ids(after)).toEqual(['a', 'c', 'b']);
    expect(hasDuplicateSort(after)).toBe(false);
  });

  it('planRepair gives every row its own number and keeps the id order', () => {
    const rows = [row('b', 10), row('a', 10), row('c', 10), row('d', 20)];
    const updates = planRepair(rows);
    const after = applySortUpdates(rows, updates);
    expect(ids(after)).toEqual(['a', 'b', 'c', 'd']);
    expect(hasDuplicateSort(after)).toBe(false);
    expect(planRepair([row('a', 1), row('b', 2)])).toEqual([]);
  });

  it('planRenumber writes nothing for a list already at step 10', () => {
    expect(planRenumber([row('a', 10), row('b', 20)])).toEqual([]);
  });
});

describe('nextSortAfterLast', () => {
  it('goes ten past the largest value, 10 for an empty list', () => {
    expect(nextSortAfterLast([])).toBe(10);
    expect(nextSortAfterLast([row('a', 10), row('b', 70), row('c', 30)])).toBe(80);
  });
});

describe('properties (random lists, seeded)', () => {
  it('every move lands the row exactly where asked, with minimal and honest updates', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const next = rng(seed);
      const rows = randomRows(next);
      const original = JSON.stringify(rows);
      const mover = rows[Math.floor(next() * rows.length)]!;
      const position = 1 + Math.floor(next() * (rows.length + 2)) - 1; // sometimes beyond the end or 0
      const label = `seed ${seed}`;

      const updates = planMoveToPosition(rows, mover.id, position);
      expect(JSON.stringify(rows), `${label} input untouched`).toBe(original);

      const before = ids(rows);
      const target = Math.min(Math.max(position, 1), rows.length) - 1;
      const expected = before.filter((id) => id !== mover.id);
      expected.splice(target, 0, mover.id);

      const after = applySortUpdates(rows, updates);
      if (target === before.indexOf(mover.id)) {
        expect(updates, `${label} same place`).toEqual([]);
        continue;
      }
      expect(ids(after), `${label} order`).toEqual(expected);
      // Updates: unique ids, real rows, never a no-op.
      const seen = new Set<string>();
      for (const u of updates) {
        expect(seen.has(u.id), `${label} unique`).toBe(false);
        seen.add(u.id);
        const old = rows.find((r) => r.id === u.id);
        expect(old, `${label} known id`).toBeDefined();
        expect(old!.sort, `${label} no-op`).not.toBe(u.sort);
        expect(Number.isInteger(u.sort), `${label} integer`).toBe(true);
      }
      // One row written, or a full renumber (step 10, no duplicates) of every row that changes.
      if (updates.length > 1) {
        expect(hasDuplicateSort(after), `${label} renumber unique`).toBe(false);
        const sorted = sortedRows(after);
        sorted.forEach((r, i) => expect(r.sort, `${label} step`).toBe((i + 1) * 10));
      } else {
        expect(updates[0]!.id, `${label} single`).toBe(mover.id);
      }
    }
  });

  it('a gap of 2 or more between the new neighbours is always a one-row write', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const next = rng(seed * 7919);
      const n = 3 + Math.floor(next() * 8);
      let sort = 0;
      const rows = Array.from({ length: n }, (_, i) => row(`r${String(i).padStart(2, '0')}`, (sort += 2 + Math.floor(next() * 9))));
      const from = Math.floor(next() * n);
      const to = Math.floor(next() * n);
      // The start is excluded: it needs room below the first row (tested above).
      if (from === to || to === 0) continue;
      const updates = planMoveToPosition(rows, rows[from]!.id, to + 1);
      expect(updates.length, `seed ${seed}`).toBe(1);
    }
  });

  it('repeated random moves keep the list consistent and never lose or invent a row', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const next = rng(seed * 104729);
      let rows = randomRows(next);
      const allIds = ids(rows).sort();
      for (let step = 0; step < 30; step++) {
        const mover = rows[Math.floor(next() * rows.length)]!;
        const wanted = 1 + Math.floor(next() * rows.length);
        const before = ids(rows);
        const expected = before.filter((id) => id !== mover.id);
        expected.splice(wanted - 1, 0, mover.id);
        rows = applySortUpdates(rows, planMoveToPosition(rows, mover.id, wanted));
        expect(ids(rows), `seed ${seed} step ${step}`).toEqual(expected);
      }
      expect(ids(rows).sort()).toEqual(allIds);
    }
  });

  it('planMove by one step equals moving to the neighbouring position', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const next = rng(seed * 31);
      const rows = randomRows(next);
      const mover = rows[Math.floor(next() * rows.length)]!;
      const index = ids(rows).indexOf(mover.id);
      expect(planMove(rows, mover.id, 1)).toEqual(planMoveToPosition(rows, mover.id, index + 2));
      expect(planMove(rows, mover.id, -1)).toEqual(planMoveToPosition(rows, mover.id, index));
    }
  });
});
