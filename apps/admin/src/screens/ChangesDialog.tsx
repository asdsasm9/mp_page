/** "Zobrazit změny": the unpublished changes, one line each, grouped by category and album, newest first. */
import type { ChangeLogRow } from '@mp/shared';
import { Modal } from '../components/Modal';
import { groupChanges, CATEGORY_OWN, NONE } from '../data/changeGroups';
import { cs } from '../i18n/cs';
import { fill, plural } from '../i18n/format';

/** Lines shown before "a dalších N". */
export const CHANGES_SHOWN = 40;

const t = cs.publish.changes;

function Line({ row }: { row: ChangeLogRow }) {
  const name = row.label !== '' ? row.label : row.table_name === 'photos' ? t.unnamedPhoto : t.unnamed;
  return (
    <li className="changes-line" data-kind={row.kind}>
      <span className="changes-what">{t.what[row.table_name]}</span>{' '}
      <span className="changes-name">{name}</span>{' '}
      <span className="changes-kind">{t.kind[row.kind]}</span>
    </li>
  );
}

export function ChangesDialog({ changes, onClose }: { changes: readonly ChangeLogRow[]; onClose: () => void }) {
  const { groups, more } = groupChanges(changes, CHANGES_SHOWN);
  return (
    <Modal title={t.title} onClose={onClose}>
      {changes.length === 0 ? (
        <p tabIndex={-1} data-autofocus>
          {t.empty}
        </p>
      ) : (
        <>
          {/* Focus starts on the summary (not on the Close button below a long list); a screen reader reads the count first. */}
          <p className="changes-summary" tabIndex={-1} data-autofocus>
            {fill(plural(changes.length, cs.publish.pending), { count: changes.length })}
          </p>
          <div className="changes-groups">
            {groups.map((group) => (
              <section key={group.key} className="changes-group" aria-label={group.name ?? t.noCategory}>
                <h3>{group.name ?? t.noCategory}</h3>
                {group.albums.map((album) => (
                  <div key={album.key} className="changes-album">
                    {album.key === CATEGORY_OWN ? null : <h4>{album.title ?? (album.key === NONE ? t.noAlbum : t.unnamed)}</h4>}
                    <ul className="changes-list">
                      {album.lines.map((row) => (
                        <Line key={row.id} row={row} />
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ))}
          </div>
          {more > 0 ? <p className="changes-more">{fill(t.more, { count: more })}</p> : null}
        </>
      )}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose}>
          {t.close}
        </button>
      </div>
    </Modal>
  );
}
