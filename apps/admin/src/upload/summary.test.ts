import { describe, expect, it } from 'vitest';
import { initialQueueState, queueReducer, type QueueAction } from './reducer';
import { etaMinutes, finishedToast, stepLabel, storageVerdict, summaryText } from './summary';
import type { QueueItem, QueueState } from './types';

const ALBUM = 'bbbbbbbb-0000-4000-8000-000000000001';

function stateWith(statuses: Array<QueueItem['status']>): QueueState {
  let state = initialQueueState;
  const act = (action: QueueAction) => {
    state = queueReducer(state, action);
  };
  statuses.forEach((status, i) => {
    const id = `dddddddd-0000-4000-8000-00000000000${i}`;
    act({ type: 'add', items: [{ id, albumId: ALBUM, name: `IMG_${i}.jpg`, size: 1000 }] });
    if (status === 'failed') act({ type: 'fail', id, failure: { kind: 'upload', message: 'x' } });
    else if (status === 'cancelled') act({ type: 'cancel', id });
    else if (status !== 'queued') act({ type: 'status', id, status });
  });
  return state;
}

describe('step labels', () => {
  const base = { paused: false, failure: null } as const;
  it('follow Ve frontě, Zpracovávám, Nahrávám, Ukládám, Hotovo', () => {
    expect(stepLabel({ ...base, status: 'queued' })).toBe('Ve frontě');
    expect(stepLabel({ ...base, status: 'encoding' })).toBe('Zpracovávám');
    expect(stepLabel({ ...base, status: 'encoded' })).toBe('Zpracovávám');
    expect(stepLabel({ ...base, status: 'uploading' })).toBe('Nahrávám');
    expect(stepLabel({ ...base, status: 'committing' })).toBe('Ukládám');
    expect(stepLabel({ ...base, status: 'done' })).toBe('Hotovo');
  });
  it('shows the wait, the failure text and the cancellation instead', () => {
    expect(stepLabel({ ...base, status: 'uploading', paused: true })).toBe('Čekám na připojení…');
    expect(stepLabel({ status: 'failed', paused: false, failure: { kind: 'upload', message: 'Nahrávání selhalo.' } })).toBe('Nahrávání selhalo.');
    expect(stepLabel({ ...base, status: 'cancelled' })).toBe('Zrušeno.');
  });
});

describe('summary and estimate', () => {
  it('needs a finished photo before it estimates, and never says 0 minutes', () => {
    expect(etaMinutes(0, 10, 60_000)).toBeNull();
    expect(etaMinutes(5, 0, 60_000)).toBeNull();
    expect(etaMinutes(23, 17, 4 * 60_000 * (23 / 17))).toBe(4);
    expect(etaMinutes(10, 1, 1000)).toBe(1);
  });

  it('"Nahráno 23 z 40 · zbývá asi 4 min" while running, only the count when idle', () => {
    const running = stateWith([...Array<'done'>(23).fill('done'), ...Array<'uploading'>(17).fill('uploading')]);
    const now = 10_000_000;
    const startedAt = now - Math.round(4 * 60_000 * (23 / 17));
    expect(summaryText(running, now, startedAt)).toBe('Nahráno 23 z 40 · zbývá asi 4 min');
    expect(summaryText(running, now, null)).toBe('Nahráno 23 z 40');
    expect(summaryText(stateWith(['done', 'done']), now, startedAt)).toBe('Nahráno 2 z 2');
  });
});

describe('toast of a finished batch', () => {
  it('"Nahráno 40 fotek." / "Nahráno 37 z 40, 3 se nepodařilo." with Czech plurals', () => {
    expect(finishedToast(stateWith(Array<'done'>(40).fill('done')))).toBe('Nahráno 40 fotek.');
    expect(finishedToast(stateWith(['done']))).toBe('Nahráno 1 fotka.');
    expect(finishedToast(stateWith(['done', 'done', 'done']))).toBe('Nahráno 3 fotky.');
    expect(finishedToast(stateWith([...Array<'done'>(37).fill('done'), 'failed', 'failed', 'failed']))).toBe(
      'Nahráno 37 z 40, 3 se nepodařilo.',
    );
  });
  it('says nothing when nothing was done or the photographer cancelled', () => {
    expect(finishedToast(initialQueueState)).toBeNull();
    expect(finishedToast(stateWith(['cancelled', 'cancelled']))).toBeNull();
    expect(finishedToast(stateWith(['done', 'cancelled']))).toBeNull();
  });
});

describe('courtesy storage pre-check', () => {
  const storage = (over: Partial<Parameters<typeof storageVerdict>[0]> = {}) => ({
    hard: 1_000_000,
    used_bytes: 0,
    reserved_bytes: 0,
    level: 'ok' as const,
    ...over,
  });

  it('blocks only on level full or nothing free; a small free space still lets the server decide', () => {
    expect(storageVerdict(storage({ level: 'full' }))).toBe('full');
    expect(storageVerdict(storage({ used_bytes: 999_999, reserved_bytes: 1 }))).toBe('full');
    expect(storageVerdict(storage({ hard: 100 }))).toBe('ok');
    expect(storageVerdict(storage({ used_bytes: 999_999 }))).toBe('ok');
    expect(storageVerdict(storage())).toBe('ok');
  });
});
