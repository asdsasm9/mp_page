/** Album picker data: lower case, no diacritics, so "dvorakovi" finds "Dvořákovi". */
import type { AlbumRow, CategoryRow } from '@mp/shared';
import { sortedRows } from './order';

export const fold = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface AlbumGroup {
  category: CategoryRow;
  albums: AlbumRow[];
}

/** Albums other than `exceptId`, grouped by category in display order; a query keeps albums whose title or category matches. */
export function groupAlbums(
  categories: readonly CategoryRow[],
  albums: readonly AlbumRow[],
  exceptId: string,
  query: string,
): AlbumGroup[] {
  const q = fold(query.trim());
  return sortedRows(categories)
    .map((category) => ({
      category,
      albums: sortedRows(albums.filter((a) => a.category_id === category.id && a.id !== exceptId)).filter(
        (a) => q === '' || fold(a.title).includes(q) || fold(category.name).includes(q),
      ),
    }))
    .filter((g) => g.albums.length > 0);
}
