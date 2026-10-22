/**
 * Ordering math for categories, albums and photos (pure, no I/O). Rows carry an integer `sort`; the order is
 * (sort, id), so rows with the same `sort` still have one deterministic order (smaller id first).
 *
 * A move returns the minimal list of `{ id, sort }` updates:
 *  - same place: none;
 *  - room between the new neighbours (gap >= 2): one update, the midpoint;
 *  - no room (or equal neighbours): renumber the whole list with step 10, but only rows whose number changes.
 * Positions are 1-based, as the photographer reads them ("Přesunout do pozice 3").
 */

export interface Ordered {
  id: string;
  sort: number;
}

export interface SortUpdate {
  id: string;
  sort: number;
}

/** Distance between neighbours after a renumber, and the step used for "start" and "end". */
export const SORT_STEP = 10;

const byOrder = (a: Ordered, b: Ordered): number => a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The rows in display order (sort, then id). Does not change the input. */
export function sortedRows<T extends Ordered>(rows: readonly T[]): T[] {
  return [...rows].sort(byOrder);
}

/** `sort` for a new row placed last. */
export function nextSortAfterLast(rows: readonly Ordered[]): number {
  let max = 0;
  for (const r of rows) if (r.sort > max) max = r.sort;
  return max + SORT_STEP;
}

/** Renumbers `desired` (the final order) with step 10; returns only the rows whose number changes. */
function renumber(desired: readonly Ordered[]): SortUpdate[] {
  const updates: SortUpdate[] = [];
  desired.forEach((row, i) => {
    const sort = (i + 1) * SORT_STEP;
    if (row.sort !== sort) updates.push({ id: row.id, sort });
  });
  return updates;
}

/** Repairs a list whose numbers collide or are not step 10: the same result as moving nothing, but writing. */
export function planRenumber(rows: readonly Ordered[]): SortUpdate[] {
  return renumber(sortedRows(rows));
}

/** Rows that share a `sort` with another row (the list needs planRepair). */
export function hasDuplicateSort(rows: readonly Ordered[]): boolean {
  return new Set(rows.map((r) => r.sort)).size !== rows.length;
}

/** Updates that give every row of a list with duplicate `sort` its own number, keeping the (sort, id) order. */
export function planRepair(rows: readonly Ordered[]): SortUpdate[] {
  return hasDuplicateSort(rows) ? renumber(sortedRows(rows)) : [];
}

/** Moves the row `id` to the 1-based `position` (clamped to the list). Unknown id: no updates. */
export function planMoveToPosition(rows: readonly Ordered[], id: string, position: number): SortUpdate[] {
  const current = sortedRows(rows);
  const from = current.findIndex((r) => r.id === id);
  if (from < 0 || current.length < 2) return [];
  const wanted = Number.isFinite(position) ? Math.trunc(position) : from + 1;
  const to = Math.min(Math.max(wanted, 1), current.length) - 1;
  if (to === from) return [];

  const moving = current[from]!;
  const desired = current.filter((r) => r.id !== id);
  desired.splice(to, 0, moving);

  const before = desired[to - 1];
  const after = desired[to + 1];
  if (before && after) {
    const gap = after.sort - before.sort;
    if (gap >= 2) return [{ id, sort: before.sort + Math.floor(gap / 2) }];
    return renumber(desired);
  }
  if (before) return [{ id, sort: before.sort + SORT_STEP }];
  if (after && after.sort - SORT_STEP >= 0) return [{ id, sort: after.sort - SORT_STEP }];
  return renumber(desired);
}

/** One step up (`-1`) or down (`1`) in the list; at the edge: no updates. */
export function planMove(rows: readonly Ordered[], id: string, direction: -1 | 1): SortUpdate[] {
  const index = sortedRows(rows).findIndex((r) => r.id === id);
  if (index < 0) return [];
  return planMoveToPosition(rows, id, index + 1 + direction);
}

export function planMoveToStart(rows: readonly Ordered[], id: string): SortUpdate[] {
  return planMoveToPosition(rows, id, 1);
}

export function planMoveToEnd(rows: readonly Ordered[], id: string): SortUpdate[] {
  return planMoveToPosition(rows, id, rows.length);
}

/** The rows after the updates were applied, in display order (for optimistic UI and tests). */
export function applySortUpdates<T extends Ordered>(rows: readonly T[], updates: readonly SortUpdate[]): T[] {
  const byId = new Map(updates.map((u) => [u.id, u.sort] as const));
  return sortedRows(rows.map((r) => (byId.has(r.id) ? { ...r, sort: byId.get(r.id)! } : r)));
}
