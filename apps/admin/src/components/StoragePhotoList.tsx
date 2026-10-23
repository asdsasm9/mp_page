/**
 * Storage screen, per-photo list (WP-10, T-263): stored size of each photo (master plus variants), biggest first, album
 * filter, per-variant breakdown on expand, share of the 10 GB limit and the shared quality verdict. One page of rows at a
 * time (PAGE_SIZE), so 500+ photos never put more than a page into the DOM. A table on wide containers, cards on narrow ones
 * (the explicit roles keep the table semantics when the cards layout changes the display of the table parts).
 */
import { PROVIDER_MAX_BYTES, type AlbumRow, type PhotoRow } from '@mp/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { buildPhotoList, formatShare, pageOf, type StoragePhotoRow, type VariantPart } from '../data/storageList';
import { cs } from '../i18n/cs';
import { fill, formatBytes } from '../i18n/format';
import { PageLoading } from './PageLoading';
import { QualityBadges } from './QualityBadge';

const t = cs.storageScreen;
const shareHeading = fill(t.colShare, { limit: formatBytes(PROVIDER_MAX_BYTES) });

function partLabel(part: VariantPart): string {
  if (part.kind === 'master') return t.partMaster;
  if (part.kind === 'webp') return fill(t.partWebp, { tier: part.tier ?? 0 });
  return part.kind === 'jpeg' ? t.partJpeg : t.partOg;
}

function Parts({ parts }: { parts: VariantPart[] }) {
  return (
    <details className="details photo-parts">
      <summary>{t.partsSummary}</summary>
      <ul className="photo-parts-list">
        {parts.map((part) => (
          <li key={part.key}>
            <span>
              {partLabel(part)} <span className="photo-parts-dims">({fill(t.partDims, { w: part.w, h: part.h })})</span>
            </span>
            <span className="num">{formatBytes(part.bytes)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Row({ row }: { row: StoragePhotoRow }) {
  return (
    <tr role="row">
      <th scope="row" role="rowheader" data-label={t.colPhoto}>
        <Link to={`/alba/${row.albumId}/foto/${row.id}`}>{fill(t.photoName, { n: row.n })}</Link>
      </th>
      <td role="cell" data-label={t.colAlbum}>
        {row.albumTitle}
      </td>
      <td role="cell" data-label={t.colDimensions}>
        {fill(t.partDims, { w: row.quality.width, h: row.quality.height })}
      </td>
      <td role="cell" className="num" data-label={t.colTotalSize}>
        {formatBytes(row.bytes)}
      </td>
      <td role="cell" className="num" data-label={shareHeading}>
        {formatShare(row.sharePercent)}
      </td>
      <td role="cell" data-label={t.colVerdict}>
        <span className="quality-badges">
          <QualityBadges quality={row.quality} />
        </span>
      </td>
      <td role="cell" data-label={t.colParts}>
        <Parts parts={row.parts} />
      </td>
    </tr>
  );
}

export function StoragePhotoList({
  albums,
  photos,
}: {
  albums: readonly AlbumRow[];
  photos: ReadonlyMap<string, PhotoRow[] | undefined>;
}) {
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const complete = albums.every((a) => photos.get(a.id) !== undefined);
  const withPhotos = useMemo(() => albums.filter((a) => (photos.get(a.id)?.length ?? 0) > 0), [albums, photos]);
  const all = useMemo(() => buildPhotoList(albums, photos, albumId), [albums, photos, albumId]);

  if (!complete) return <PageLoading>{cs.data.loading}</PageLoading>;
  if (withPhotos.length === 0) return <p className="page-note">{t.breakdownEmpty}</p>;

  const view = pageOf(all, page);
  const atStart = view.page === 0;
  const atEnd = view.page >= view.pages - 1;

  return (
    <div className="photo-list">
      <div className="field photo-list-filter">
        <label htmlFor="storage-album-filter">{t.filterLabel}</label>
        <select
          id="storage-album-filter"
          value={albumId ?? ''}
          onChange={(e) => {
            setAlbumId(e.target.value === '' ? null : e.target.value);
            setPage(0);
          }}
        >
          <option value="">{t.filterAll}</option>
          {withPhotos.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
      </div>

      <p className="page-note" role="status" aria-live="polite">
        {fill(t.range, { from: view.from, to: view.to, total: view.total })}
      </p>

      <div className="photo-list-scroll">
        <table className="data-table photo-list-table" role="table">
          <caption className="visually-hidden">{t.photosCaption}</caption>
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">
                {t.colPhoto}
              </th>
              <th scope="col" role="columnheader">
                {t.colAlbum}
              </th>
              <th scope="col" role="columnheader">
                {t.colDimensions}
              </th>
              <th scope="col" role="columnheader" className="num">
                {t.colTotalSize}
              </th>
              <th scope="col" role="columnheader" className="num">
                {shareHeading}
              </th>
              <th scope="col" role="columnheader">
                {t.colVerdict}
              </th>
              <th scope="col" role="columnheader">
                {t.colParts}
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {view.rows.map((row) => (
              <Row key={row.id} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      {view.pages > 1 ? (
        <nav className="photo-pager" aria-label={t.pagerLabel}>
          <button
            type="button"
            className="button"
            aria-disabled={atStart || undefined}
            onClick={() => {
              if (!atStart) setPage(view.page - 1);
            }}
          >
            {t.pagePrev}
          </button>
          <span className="photo-pager-count">{fill(t.pageOf, { page: view.page + 1, pages: view.pages })}</span>
          <button
            type="button"
            className="button"
            aria-disabled={atEnd || undefined}
            onClick={() => {
              if (!atEnd) setPage(view.page + 1);
            }}
          >
            {t.pageNext}
          </button>
        </nav>
      ) : null}
    </div>
  );
}
