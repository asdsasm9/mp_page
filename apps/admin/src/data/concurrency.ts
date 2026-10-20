import type { UpdateOptions } from '../ports';
import { CatalogError } from '../ports/errors';

/**
 * Optimistic concurrency: every edit sends the updated_at of the row it was based on. If the row changed
 * meanwhile (another tab, another device) the update matches nothing and the port throws STALE.
 */
export function expectUpdatedAt(row: { updated_at: string }): UpdateOptions {
  return { expectedUpdatedAt: row.updated_at };
}

export function isStale(error: unknown): boolean {
  return error instanceof CatalogError && error.code === 'STALE';
}
