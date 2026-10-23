/** Storage screen (`/ulozeni`, ADMIN-UX 3.7): large bar, per-album breakdown, storage check and orphan cleanup. */
import type { AlbumRow, PhotoRow } from '@mp/shared';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LoadFailure } from '../components/LoadFailure';
import { Modal } from '../components/Modal';
import { Notice } from '../components/Notice';
import { PageLoading } from '../components/PageLoading';
import { useDocumentTitle } from '../components/Page';
import { StorageBar } from '../components/StorageBar';
import { StoragePhotoList } from '../components/StoragePhotoList';
import { buildBreakdown, photoLocations } from '../data/breakdown';
import { useAlbums, usePhotosByAlbum } from '../data/catalog';
import { useCanMutate } from '../data/health';
import {
  hasOnlyInFlightDifference,
  isClean,
  orphanBytes,
  orphanObjects,
  useReconcile,
  type ReconcileReport,
} from '../data/reconcile';
import { useStorage } from '../data/storage';
import { cs, glossary } from '../i18n/cs';
import { fill, formatBytes, formatCount, plural } from '../i18n/format';
import { errorMessage } from '../i18n/messages';

const t = cs.storageScreen;
/** Rows shown per kind of finding; the rest is summarised so a big report stays readable. */
const ROW_LIMIT = 50;

function Breakdown({ albums }: { albums: AlbumRow[] }) {
  const ids = useMemo(() => albums.map((a) => a.id), [albums]);
  const photos = usePhotosByAlbum(ids);
  const storage = useStorage();
  const view = buildBreakdown(albums, photos);
  const reserved = storage.data?.reserved_bytes ?? 0;

  if (!view.complete) {
    return (
      <PageLoading>{cs.data.loading}</PageLoading>
    );
  }
  if (view.rows.length === 0) return <p className="page-note">{t.breakdownEmpty}</p>;
  return (
    <>
      <table className="data-table">
        <caption className="visually-hidden">{t.breakdownCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{t.colAlbum}</th>
            <th scope="col" className="num">
              {t.colPhotos}
            </th>
            <th scope="col" className="num">
              {t.colSize}
            </th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">
                <Link to={`/alba/${row.id}`}>{row.title}</Link>
              </th>
              <td className="num">{row.photos}</td>
              <td className="num">{formatBytes(row.bytes)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{t.total}</th>
            <td className="num">{view.totalPhotos}</td>
            <td className="num">{formatBytes(view.totalBytes)}</td>
          </tr>
        </tfoot>
      </table>
      {reserved > 0 ? <p className="page-note">{fill(t.reservedNote, { size: formatBytes(reserved) })}</p> : null}
    </>
  );
}

function Finding({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <section className="finding">
      <h3>{title}</h3>
      <p>{body}</p>
      {children}
    </section>
  );
}

function limited<T>(items: readonly T[]): { shown: T[]; extra: number } {
  return { shown: items.slice(0, ROW_LIMIT), extra: Math.max(items.length - ROW_LIMIT, 0) };
}

function MoreRow({ extra }: { extra: number }) {
  return extra > 0 ? <li className="page-note">{fill(t.more, { count: extra })}</li> : null;
}

function Report({
  report,
  albums,
  photos,
  canMutate,
  onCleanup,
}: {
  report: ReconcileReport;
  albums: AlbumRow[];
  photos: ReadonlyMap<string, PhotoRow[] | undefined>;
  canMutate: boolean;
  onCleanup: () => void;
}) {
  const where = useMemo(() => photoLocations(albums, photos), [albums, photos]);
  const place = (id: string) => {
    const hit = where.get(id);
    return hit ? fill(t.whereKnown, { n: hit.n, album: hit.album }) : t.whereUnknown;
  };

  if (isClean(report)) {
    return (
      <Notice variant="info" as="div">
        <p>
          <strong>{t.matches}</strong>
        </p>
        <p className="page-note">
          {fill(t.matchesDetail, {
            photos: formatCount(report.db.photos, cs.units.photo),
            size: formatBytes(report.db.bytes),
          })}
        </p>
      </Notice>
    );
  }

  const missing = limited(report.missing);
  const mismatch = limited(report.sizeMismatch);
  const unknown = limited(report.unknownKeys);
  const orphanFiles = orphanObjects(report);

  return (
    <div className="findings">
      {hasOnlyInFlightDifference(report) ? (
        <p className="notice">
          {fill(t.inFlight, { db: formatBytes(report.db.bytes), r2: formatBytes(report.r2.bytes) })}
        </p>
      ) : (
        <h3>{t.findingsTitle}</h3>
      )}

      {report.orphans.length > 0 ? (
        <Finding
          title={t.orphansTitle}
          body={fill(t.orphansBody, {
            files: formatCount(orphanFiles, cs.units.file),
            size: formatBytes(orphanBytes(report)),
          })}
        >
          <button type="button" className="button button-danger" disabled={!canMutate} onClick={onCleanup}>
            {t.cleanup}
          </button>
        </Finding>
      ) : null}

      {report.missing.length > 0 ? (
        <Finding title={t.missingTitle} body={fill(t.missingBody, { photos: formatCount(report.missing.length, cs.units.photo) })}>
          <ul className="finding-rows">
            {missing.shown.map((m) => (
              <li key={m.id}>{fill(t.missingRow, { where: place(m.id), files: formatCount(m.keys.length, cs.units.file) })}</li>
            ))}
            <MoreRow extra={missing.extra} />
          </ul>
        </Finding>
      ) : null}

      {report.sizeMismatch.length > 0 ? (
        <Finding
          title={t.mismatchTitle}
          body={fill(t.mismatchBody, { files: formatCount(report.sizeMismatch.length, cs.units.file) })}
        >
          <ul className="finding-rows">
            {mismatch.shown.map((m) => (
              <li key={`${m.id}/${m.key}`}>
                {fill(t.mismatchRow, { where: place(m.id), expected: formatBytes(m.expected), actual: formatBytes(m.actual) })}
              </li>
            ))}
            <MoreRow extra={mismatch.extra} />
          </ul>
        </Finding>
      ) : null}

      {report.unknownKeys.length > 0 ? (
        <Finding title={t.unknownTitle} body={fill(t.unknownBody, { files: formatCount(report.unknownKeys.length, cs.units.file) })}>
          <details className="details">
            <summary>{glossary.details}</summary>
            <ul className="finding-rows">
              {unknown.shown.map((key) => (
                <li key={key}>
                  <code>{key}</code>
                </li>
              ))}
              <MoreRow extra={unknown.extra} />
            </ul>
          </details>
        </Finding>
      ) : null}
    </div>
  );
}

function CleanupDialog({
  report,
  working,
  onConfirm,
  onClose,
}: {
  report: ReconcileReport;
  working: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={t.cleanupTitle} onClose={onClose} busy={working}>
      <p>
        {fill(t.cleanupBody, {
          files: formatCount(orphanObjects(report), cs.units.file),
          size: formatBytes(orphanBytes(report)),
        })}
      </p>
      <div className="dialog-actions">
        <button
          type="button"
          className="button button-danger"
          aria-disabled={working || undefined}
          aria-busy={working || undefined}
          onClick={() => {
            if (!working) onConfirm();
          }}
        >
          {working ? t.cleaning : glossary.delete}
        </button>
        <button type="button" className="button" data-autofocus="" aria-disabled={working || undefined} onClick={() => !working && onClose()}>
          {glossary.cancel}
        </button>
      </div>
    </Modal>
  );
}

export function StorageScreen() {
  useDocumentTitle(cs.routes.storage.title);
  const albums = useAlbums();
  const albumRows = useMemo(() => albums.data ?? [], [albums.data]);
  const ids = useMemo(() => albumRows.map((a) => a.id), [albumRows]);
  const photos = usePhotosByAlbum(ids);
  const canMutate = useCanMutate();
  const { check, cleanup, runCheck, runCleanup } = useReconcile();
  const [confirming, setConfirming] = useState(false);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const [focusResult, setFocusResult] = useState(false);

  useEffect(() => {
    if (!focusResult) return;
    resultRef.current?.focus();
    setFocusResult(false);
  }, [focusResult]);

  const running = check.kind === 'running';
  const report = check.kind === 'done' ? check.report : null;

  async function confirmCleanup() {
    const ok = await runCleanup();
    setConfirming(false);
    if (ok) {
      // The orphan button that opened the dialog is gone after the re-check; focus lands on the result heading.
      setFocusResult(true);
      await runCheck();
    }
  }

  return (
    <div className="page">
      <h1>{cs.routes.storage.title}</h1>
      <StorageBar variant="large" />

      <section aria-labelledby="storage-breakdown-title">
        <h2 id="storage-breakdown-title">{t.breakdownTitle}</h2>
        {albums.isError ? (
          <LoadFailure error={albums.error} message={t.breakdownFailed} onRetry={() => void albums.refetch()} />
        ) : albums.data ? (
          <Breakdown albums={albumRows} />
        ) : (
          <PageLoading>{cs.data.loading}</PageLoading>
        )}
      </section>

      <section aria-labelledby="storage-photos-title">
        <h2 id="storage-photos-title">{t.photosTitle}</h2>
        <p className="page-note">{t.photosIntro}</p>
        {albums.isError ? null : albums.data ? <StoragePhotoList albums={albumRows} photos={photos} /> : <PageLoading>{cs.data.loading}</PageLoading>}
      </section>

      <section aria-labelledby="storage-check-title">
        <h2 id="storage-check-title" ref={resultRef} tabIndex={-1}>
          {t.checkTitle}
        </h2>
        <p className="page-note">{t.checkIntro}</p>
        <p>
          <button
            type="button"
            className="button button-primary"
            disabled={!canMutate}
            aria-disabled={running || undefined}
            aria-busy={running || undefined}
            onClick={() => {
              if (!running) void runCheck();
            }}
          >
            {glossary.checkStorage}
          </button>
        </p>
        <div role="status" aria-live="polite">
          {check.kind === 'running' ? fill(t.checking, { objects: check.objects }) : null}
          {cleanup.kind === 'done'
            ? fill(plural(cleanup.deleted, t.cleaned), {
                files: formatCount(cleanup.deleted, cs.units.file),
                size: formatBytes(cleanup.freedBytes),
              })
            : null}
        </div>
        {check.kind === 'failed' ? (
          <Notice as="div">
            <p>{t.checkFailed}</p>
            <p className="page-note">{errorMessage(check.error)}</p>
            <button type="button" className="button" onClick={() => void runCheck()}>
              {glossary.retry}
            </button>
          </Notice>
        ) : null}
        {cleanup.kind === 'failed' ? (
          <Notice>
            {t.cleanupFailed} {errorMessage(cleanup.error)}
          </Notice>
        ) : null}
        {report ? (
          <Report
            report={report}
            albums={albumRows}
            photos={photos}
            canMutate={canMutate}
            onCleanup={() => setConfirming(true)}
          />
        ) : null}
      </section>

      {confirming && report ? (
        <CleanupDialog
          report={report}
          working={cleanup.kind === 'running'}
          onConfirm={() => void confirmCleanup()}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}
