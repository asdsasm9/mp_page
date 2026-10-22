/** Groups the change log for the "Zobrazit změny" dialog: category, then album, newest first, with a line limit. */
import type { ChangeLogRow } from '@mp/shared';

/** Key of the pseudo album that holds the lines of the category itself. */
export const CATEGORY_OWN = '__category__';
export const NONE = '__none__';

export interface AlbumGroup {
  key: string;
  /** Album title at the newest change; null for the category's own lines and for unknown albums. */
  title: string | null;
  lines: ChangeLogRow[];
}

export interface CategoryGroup {
  key: string;
  name: string | null;
  albums: AlbumGroup[];
}

export interface GroupedChanges {
  groups: CategoryGroup[];
  shown: number;
  more: number;
}

/**
 * `rows` must be newest first (the port returns them so). The first `limit` rows are shown, the rest is
 * counted in `more`; groups and lines keep the newest-first order, so a group sits where its newest line is.
 */
export function groupChanges(rows: readonly ChangeLogRow[], limit: number): GroupedChanges {
  const visible = rows.slice(0, Math.max(0, limit));
  const groups: CategoryGroup[] = [];
  for (const row of visible) {
    const categoryKey = row.category_id ?? NONE;
    let group = groups.find((g) => g.key === categoryKey);
    if (!group) {
      group = { key: categoryKey, name: row.category_name, albums: [] };
      groups.push(group);
    }
    const albumKey = row.table_name === 'categories' ? CATEGORY_OWN : (row.album_id ?? NONE);
    let album = group.albums.find((a) => a.key === albumKey);
    if (!album) {
      album = { key: albumKey, title: albumKey === CATEGORY_OWN ? null : row.album_title, lines: [] };
      group.albums.push(album);
    }
    album.lines.push(row);
  }
  return { groups, shown: visible.length, more: rows.length - visible.length };
}
