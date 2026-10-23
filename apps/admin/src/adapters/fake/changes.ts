/**
 * The fake change_log: trigger log_change of supabase/migrations/20261022160000_change_log.sql, in memory.
 * One line per catalog row; added stays added, a row added and deleted before publishing leaves no line,
 * a sort-only update is "reordered", an update that changes nothing is not logged. url_history is not logged.
 */
import type { AlbumRow, CategoryRow, ChangeKind, ChangeLogRow, ChangeTable, PhotoRow, SiteSettingsRow } from '@mp/shared';
import type { Core } from './core';

type Row = CategoryRow | AlbumRow | PhotoRow;

function sameExcept(a: Row, b: Row, skip: readonly string[]): boolean {
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const k of keys) {
    if (skip.includes(k)) continue;
    if (JSON.stringify(ra[k] ?? null) !== JSON.stringify(rb[k] ?? null)) return false;
  }
  return true;
}

function context(core: Core, table: ChangeTable, row: Row): Pick<ChangeLogRow, 'label' | 'category_id' | 'category_name' | 'album_id' | 'album_title'> {
  const { state } = core;
  if (table === 'categories') {
    const c = row as CategoryRow;
    return { label: c.name, category_id: c.id, category_name: c.name, album_id: null, album_title: null };
  }
  if (table === 'albums') {
    const a = row as AlbumRow;
    return {
      label: a.title,
      category_id: a.category_id,
      category_name: state.categories.get(a.category_id)?.name ?? null,
      album_id: a.id,
      album_title: a.title,
    };
  }
  const p = row as PhotoRow;
  const album = state.albums.get(p.album_id);
  const label = p.alt?.trim() || p.caption?.trim() || '';
  return {
    label,
    category_id: album?.category_id ?? null,
    category_name: album ? (state.categories.get(album.category_id)?.name ?? null) : null,
    album_id: p.album_id,
    album_title: album?.title ?? null,
  };
}

/** Call after the row was inserted or updated, and after it was deleted (`before` is the row that is gone). */
export function logChange(
  core: Core,
  table: ChangeTable,
  change: { op: 'insert'; after: Row } | { op: 'update'; before: Row; after: Row } | { op: 'delete'; before: Row },
): void {
  let kind: ChangeKind;
  let row: Row;
  if (change.op === 'insert') {
    kind = 'added';
    row = change.after;
  } else if (change.op === 'delete') {
    kind = 'deleted';
    row = change.before;
  } else {
    row = change.after;
    if (sameExcept(change.before, change.after, ['updated_at'])) return;
    kind = sameExcept(change.before, change.after, ['updated_at', 'sort']) ? 'reordered' : 'edited';
  }

  record(core, table, row.id, kind, context(core, table, row));
}

/** change_log row id of the single site_settings row (its own key is a boolean); same uuid as the migration logs. */
export const SITE_SETTINGS_LOG_ID = '00000000-0000-4000-8000-000000000001';
export const SITE_SETTINGS_LABEL = 'Hlavní fotka úvodní stránky';

/** Trigger log_change for site_settings (an update that changes nothing is not logged). */
export function logSettingsChange(core: Core, before: SiteSettingsRow, after: SiteSettingsRow): void {
  if (before.hero_photo_id === after.hero_photo_id) return;
  record(core, 'site_settings', SITE_SETTINGS_LOG_ID, 'edited', {
    label: SITE_SETTINGS_LABEL,
    category_id: null,
    category_name: null,
    album_id: null,
    album_title: null,
  });
}

type Context = Pick<ChangeLogRow, 'label' | 'category_id' | 'category_name' | 'album_id' | 'album_title'>;

function record(core: Core, table: ChangeTable, rowId: string, kind: ChangeKind, ctx: Context): void {
  const { state } = core;
  const log = state.changeLog;
  const i = log.findIndex((l) => l.table_name === table && l.row_id === rowId);
  const old = log[i];
  if (!old) {
    log.push({ id: ++state.changeSeq, at: core.iso(), table_name: table, row_id: rowId, kind, ...ctx });
    return;
  }
  if (kind === 'deleted' && old.kind === 'added') {
    log.splice(i, 1);
    return;
  }
  old.at = core.iso();
  old.kind =
    kind === 'deleted' ? 'deleted' : old.kind === 'deleted' ? 'edited' : old.kind === 'added' ? 'added' : old.kind === 'reordered' ? kind : 'edited';
  Object.assign(old, ctx);
}

/** What the real port returns: newest first, then highest id first. */
export function sortedChangeLog(log: readonly ChangeLogRow[]): ChangeLogRow[] {
  return [...log].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id));
}
