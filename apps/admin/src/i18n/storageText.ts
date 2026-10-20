import type { StorageResponse } from '@mp/shared';
import { cs } from './cs';
import { formatBytes } from './format';

export interface StorageView {
  level: StorageResponse['level'];
  /** The sentence for the level (ADMIN-UX 3.7), numbers from the response. */
  text: string;
  /** Short state word for the mini bar; null when the level is ok. */
  shortState: string | null;
  /** ok: none, warn: status, full: alert. */
  role: 'status' | 'alert' | undefined;
  used: string;
  hard: string;
  /** Whole percent of the hard limit as the response reports it (0 when hard is 0). */
  percent: number;
}

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');

/** Everything shown comes from the GET /storage response: the limits are never constants in the admin. */
export function describeStorage(storage: StorageResponse): StorageView {
  const used = formatBytes(storage.used_bytes);
  const hard = formatBytes(storage.hard);
  const percent = storage.hard > 0 ? Math.round((storage.used_bytes / storage.hard) * 100) : 0;
  const values = { used, hard };
  switch (storage.level) {
    case 'warn':
      return { level: 'warn', text: fill(cs.storage.warn, values), shortState: cs.storage.warnShort, role: 'status', used, hard, percent };
    case 'full':
      return { level: 'full', text: cs.storage.full, shortState: cs.storage.fullShort, role: 'alert', used, hard, percent };
    default:
      return { level: 'ok', text: fill(cs.storage.ok, values), shortState: null, role: undefined, used, hard, percent };
  }
}

export const percentText = (percent: number) => fill(cs.storage.percent, { percent: String(percent) });
/** The plain "Úložiště 3,2 z 9,5 GB" line (used in the mini bar for every level). */
export const usageLine = (view: Pick<StorageView, 'used' | 'hard'>) => fill(cs.storage.ok, { used: view.used, hard: view.hard });
