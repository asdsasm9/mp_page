/**
 * Storage check (POST /storage/reconcile, docs/API.md). The check is read-only and follows the cursor until
 * the Worker returns none; the pages add up to one full run. Cleaning orphans is a separate action that is
 * only started from a confirmation and is the only caller that sends `apply: true`. Missing objects and
 * size mismatches are reports only: nothing here writes anything for them.
 */
import type { ReconcileResponse } from '@mp/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../auth/session';
import { NetworkError } from '../ports';
import { usePorts } from '../ports-context';
import { isOnline } from './health';
import { refreshStorageAndSite } from './storage';

/** Safety stop: 20 pages of 1000 objects per call means this is never reached in practice. */
const MAX_PAGES = 1000;

export interface ReconcileReport {
  pages: number;
  r2: { objects: number; bytes: number };
  db: { photos: number; bytes: number };
  orphans: ReconcileResponse['orphans'];
  missing: ReconcileResponse['missing'];
  sizeMismatch: ReconcileResponse['sizeMismatch'];
  unknownKeys: string[];
  /** Objects deleted by `apply: true` pages (0 for a plain check). */
  deleted: number;
}

export const emptyReport = (): ReconcileReport => ({
  pages: 0,
  r2: { objects: 0, bytes: 0 },
  db: { photos: 0, bytes: 0 },
  orphans: [],
  missing: [],
  sizeMismatch: [],
  unknownKeys: [],
  deleted: 0,
});

export function mergePage(report: ReconcileReport, page: ReconcileResponse): ReconcileReport {
  return {
    pages: report.pages + 1,
    r2: { objects: report.r2.objects + page.r2.objects, bytes: report.r2.bytes + page.r2.bytes },
    db: { photos: report.db.photos + page.db.photos, bytes: report.db.bytes + page.db.bytes },
    orphans: [...report.orphans, ...page.orphans],
    missing: [...report.missing, ...page.missing],
    sizeMismatch: [...report.sizeMismatch, ...page.sizeMismatch],
    unknownKeys: [...report.unknownKeys, ...page.unknownKeys],
    deleted: report.deleted + page.deleted,
  };
}

export const orphanObjects = (report: ReconcileReport) => report.orphans.reduce((n, o) => n + o.objects, 0);
export const orphanBytes = (report: ReconcileReport) => report.orphans.reduce((n, o) => n + o.bytes, 0);

/** Nothing found and the two totals agree. */
export const isClean = (r: ReconcileReport) =>
  r.orphans.length === 0 &&
  r.missing.length === 0 &&
  r.sizeMismatch.length === 0 &&
  r.unknownKeys.length === 0 &&
  r.r2.bytes === r.db.bytes;

/** No findings, but the bucket holds more than the rows: young objects of uploads that are still running. */
export const hasOnlyInFlightDifference = (r: ReconcileReport) =>
  r.orphans.length === 0 &&
  r.missing.length === 0 &&
  r.sizeMismatch.length === 0 &&
  r.unknownKeys.length === 0 &&
  r.r2.bytes !== r.db.bytes;

export type CheckState =
  | { kind: 'idle' }
  | { kind: 'running'; objects: number }
  | { kind: 'done'; report: ReconcileReport }
  | { kind: 'failed'; error: unknown };

export type CleanupState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; deleted: number; freedBytes: number }
  | { kind: 'failed'; error: unknown };

export function useReconcile() {
  const { api } = usePorts();
  const { runAuthed } = useSession();
  const queryClient = useQueryClient();
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' });
  const [cleanup, setCleanup] = useState<CleanupState>({ kind: 'idle' });
  const alive = useRef(true);
  const busy = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Repeats the call with the returned cursor until there is none. */
  const walk = useCallback(
    async (apply: boolean, onPage: (report: ReconcileReport) => void): Promise<ReconcileReport> => {
      let report = emptyReport();
      let cursor: string | undefined;
      for (let i = 0; i < MAX_PAGES; i++) {
        if (!isOnline()) throw new NetworkError();
        const request = {
          ...(apply ? { apply: true } : {}),
          ...(cursor === undefined ? {} : { cursor }),
        };
        const page = await runAuthed(() => api.reconcile(request));
        report = mergePage(report, page);
        if (alive.current) onPage(report);
        if (page.cursor === undefined || page.cursor === cursor) break;
        cursor = page.cursor;
      }
      return report;
    },
    [api, runAuthed],
  );

  const runCheck = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setCheck({ kind: 'running', objects: 0 });
    try {
      const report = await walk(false, (r) => setCheck({ kind: 'running', objects: r.r2.objects }));
      if (alive.current) setCheck({ kind: 'done', report });
    } catch (error) {
      if (alive.current) setCheck({ kind: 'failed', error });
    } finally {
      busy.current = false;
    }
  }, [walk]);

  /** Only call this from the confirmed dialog: it is the one place that sends `apply: true`. */
  const runCleanup = useCallback(async () => {
    if (busy.current) return false;
    busy.current = true;
    setCleanup({ kind: 'running' });
    try {
      const report = await walk(true, () => undefined);
      const freedBytes = orphanBytes(report);
      if (alive.current) setCleanup({ kind: 'done', deleted: report.deleted, freedBytes });
      await refreshStorageAndSite(queryClient);
      return true;
    } catch (error) {
      if (alive.current) setCleanup({ kind: 'failed', error });
      return false;
    } finally {
      busy.current = false;
    }
  }, [queryClient, walk]);

  return { check, cleanup, runCheck, runCleanup };
}
