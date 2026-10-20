/**
 * Pure helpers of the upload UI: step label of a row, the summary sentence with the time estimate, the toast text
 * of a finished batch, and the courtesy storage pre-check. No React, no DOM.
 */
import type { StorageResponse } from '@mp/shared';
import { cs, glossary } from '../i18n/cs';
import { fill, formatCount } from '../i18n/format';
import { summarize } from './reducer';
import type { QueueItem, QueueState } from './types';

/** Label of the step a row is in, in the order Ve frontě, Zpracovávám, Nahrávám, Ukládám, Hotovo. */
export function stepLabel(item: Pick<QueueItem, 'status' | 'paused' | 'failure'>): string {
  if (item.status === 'failed') return item.failure?.message ?? cs.upload.corrupt;
  if (item.status === 'cancelled') return cs.upload.cancelled;
  if (item.paused) return cs.upload.waiting;
  switch (item.status) {
    case 'queued':
      return glossary.queued;
    case 'encoding':
    case 'encoded':
    case 'reserving':
      return glossary.processing;
    case 'reserved':
    case 'uploading':
      return glossary.uploadingNow;
    case 'uploaded':
    case 'committing':
      return cs.upload.saving;
    case 'done':
      return glossary.done;
    default:
      return glossary.queued;
  }
}

/** Estimated whole minutes left (at least 1), or null while there is nothing to base it on. */
export function etaMinutes(done: number, remaining: number, elapsedMs: number): number | null {
  if (done < 1 || remaining < 1 || elapsedMs <= 0) return null;
  const msLeft = (elapsedMs / done) * remaining;
  return Math.max(1, Math.round(msLeft / 60_000));
}

/** "Nahráno 23 z 40 · zbývá asi 4 min". */
export function summaryText(state: QueueState, now: number, startedAt: number | null): string {
  const s = summarize(state);
  const head = fill(cs.upload.summary, { done: s.done, total: s.total });
  if (s.active === 0 || startedAt === null) return head;
  const minutes = etaMinutes(s.done, s.active, now - startedAt);
  if (minutes === null) return head;
  const tail = fill(cs.upload.eta, { minutes });
  return `${head}${cs.upload.separator}${tail}`;
}

/** The toast when the queue has gone idle, or null when there is nothing to report (all cancelled, nothing done). */
export function finishedToast(state: QueueState): string | null {
  const s = summarize(state);
  if (s.done + s.failed === 0) return null;
  if (s.failed === 0 && s.cancelled === 0) return fill(cs.upload.doneAll, { photos: formatCount(s.done, cs.units.photo) });
  if (s.failed === 0) return null; // the photographer cancelled: nothing to announce
  return fill(cs.upload.donePartial, { done: s.done, total: s.done + s.failed + s.cancelled, failed: s.failed });
}

/**
 * Courtesy check before anything is queued: 'full' only when the level already is full or nothing is free. File
 * sizes say nothing certain about the encoded size, so everything else is queued and the server decides (first-fit).
 */
export function storageVerdict(
  storage: Pick<StorageResponse, 'hard' | 'used_bytes' | 'reserved_bytes' | 'level'>,
): 'ok' | 'full' {
  if (storage.level === 'full') return 'full';
  return storage.hard - storage.used_bytes - storage.reserved_bytes <= 0 ? 'full' : 'ok';
}
