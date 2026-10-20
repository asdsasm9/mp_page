import { abortError, type Clock, type Ids } from '../../ports';

export interface ManualClock extends Clock {
  /** Moves time forward and settles every sleep that falls due, oldest first. */
  advance(ms: number): Promise<void>;
  set(epochMs: number): void;
}

export const DEFAULT_START = Date.parse('2026-10-20T08:00:00.000Z');

export function createManualClock(start: number = DEFAULT_START): ManualClock {
  let t = start;
  let sleepers: { at: number; resolve: () => void }[] = [];
  return {
    now: () => t,
    set(epochMs) {
      t = epochMs;
    },
    sleep(ms, signal) {
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(abortError());
        const entry = { at: t + ms, resolve };
        sleepers.push(entry);
        signal?.addEventListener(
          'abort',
          () => {
            sleepers = sleepers.filter((s) => s !== entry);
            reject(abortError());
          },
          { once: true },
        );
      });
    },
    async advance(ms) {
      const target = t + ms;
      for (;;) {
        const due = sleepers.filter((s) => s.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        sleepers = sleepers.filter((s) => s !== due);
        t = Math.max(t, due.at);
        due.resolve();
        for (let i = 0; i < 10; i++) await Promise.resolve(); // let the continuation run first
      }
      t = target;
    },
  };
}

/** Deterministic, valid lowercase UUIDs: dddddddd-0000-4000-8000-000000000001, ...0002, ... */
export function createSeqIds(prefix = 'dddddddd'): Ids {
  let n = 0;
  return { uuid: () => `${prefix}-0000-4000-8000-${String(++n).padStart(12, '0')}` };
}
