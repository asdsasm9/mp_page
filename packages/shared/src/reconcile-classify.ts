/**
 * The pure part of storage reconcile (WP-4 section 4.7), shared by the Worker route
 * (apps/api/src/routes/reconcile.ts) and the in-memory fake (apps/admin/src/adapters/fake/api.ts) so the two
 * cannot drift: which object groups are orphans or unknown keys, and which rows have missing or wrong-sized files.
 * Listing, paging, reservations and deleting stay with the callers.
 */
import { ORPHAN_MIN_AGE_MS } from './limits';
import { allKeys, isValidPhotoId, parseKey } from './keys';
import { variantBytes } from './commit-rules';
import type { PhotoVariants } from './variants';

export interface ReconcileObject {
  key: string;
  bytes: number;
  /** Upload time in epoch ms; undefined when the store does not say (never old enough to delete). */
  uploadedMs: number | undefined;
}

export interface ReconcileOrphan {
  id: string;
  objects: number;
  bytes: number;
}

/**
 * Judges whole groups of objects (grouped by the first path segment under `photos/`, the photo id).
 * Groups are visited in segment order. Orphans are valid ids with no row, no live reservation and every
 * object older than ORPHAN_MIN_AGE_MS; anything else with a bad id, or a malformed key under a row, is unknown.
 */
export function classifyGroups(
  groups: ReadonlyMap<string, readonly ReconcileObject[]>,
  rowIds: ReadonlySet<string>,
  reserved: ReadonlySet<string>,
  nowMs: number,
): { orphans: ReconcileOrphan[]; orphanKeys: string[][]; unknownKeys: string[] } {
  const cutoff = nowMs - ORPHAN_MIN_AGE_MS;
  const orphans: ReconcileOrphan[] = [];
  const orphanKeys: string[][] = [];
  const unknownKeys: string[] = [];
  for (const [seg, list] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!isValidPhotoId(seg)) {
      unknownKeys.push(...list.map((o) => o.key));
      continue;
    }
    if (rowIds.has(seg)) {
      unknownKeys.push(...list.filter((o) => parseKey(o.key) === null).map((o) => o.key));
      continue;
    }
    if (reserved.has(seg)) continue;
    if (!list.every((o) => o.uploadedMs !== undefined && o.uploadedMs < cutoff)) continue;
    orphans.push({ id: seg, objects: list.length, bytes: list.reduce((a, o) => a + o.bytes, 0) });
    orphanKeys.push(list.map((o) => o.key));
  }
  return { orphans, orphanKeys, unknownKeys };
}

/** Rows whose files are gone or have another size than the row says, in row order. */
export function checkRows(
  rows: readonly { id: string; variants: PhotoVariants }[],
  byKey: ReadonlyMap<string, { bytes: number }>,
): {
  missing: { id: string; keys: string[] }[];
  sizeMismatch: { id: string; key: string; expected: number; actual: number }[];
} {
  const missing: { id: string; keys: string[] }[] = [];
  const sizeMismatch: { id: string; key: string; expected: number; actual: number }[] = [];
  for (const row of rows) {
    const expected = variantBytes(row.variants);
    const gone: string[] = [];
    for (const [i, key] of allKeys(row.id, row.variants).entries()) {
      const found = byKey.get(key);
      if (!found) gone.push(key);
      else if (found.bytes !== expected[i]) sizeMismatch.push({ id: row.id, key, expected: expected[i]!, actual: found.bytes });
    }
    if (gone.length > 0) missing.push({ id: row.id, keys: gone });
  }
  return { missing, sizeMismatch };
}
