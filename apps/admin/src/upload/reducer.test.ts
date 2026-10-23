import { describe, expect, it } from 'vitest';
import { initialQueueState, queueReducer, type QueueAction } from './reducer';
import { stepLabel } from './summary';
import type { QueueState } from './types';

const run = (...actions: QueueAction[]): QueueState => actions.reduce(queueReducer, initialQueueState);
const add: QueueAction = { type: 'add', items: [{ id: 'a', albumId: 'x', name: 'a.jpg', size: 1 }] };
const first = (s: QueueState) => s.items[0]!;

describe('queue reducer: phase and small-photo warning (T-268)', () => {
  it('a new item has no phase and no warning', () => {
    expect(first(run(add))).toMatchObject({ phase: null, smallEdge: null });
  });

  it('phase only applies while encoding, and any other status clears it', () => {
    expect(first(run(add, { type: 'phase', id: 'a', phase: 'previews' })).phase).toBeNull(); // still queued
    const encoding = run(add, { type: 'status', id: 'a', status: 'encoding' }, { type: 'phase', id: 'a', phase: 'previews' });
    expect(first(encoding).phase).toBe('previews');
    expect(first(queueReducer(encoding, { type: 'phase', id: 'a', phase: 'detail' })).phase).toBe('detail');
    expect(first(queueReducer(encoding, { type: 'status', id: 'a', status: 'encoded' })).phase).toBeNull();
    expect(first(queueReducer(encoding, { type: 'fail', id: 'a', failure: { kind: 'corrupt', message: 'x' } })).phase).toBeNull();
    expect(first(queueReducer(encoding, { type: 'cancel', id: 'a' })).phase).toBeNull();
  });

  it('a late phase after a terminal state changes nothing', () => {
    const cancelled = run(add, { type: 'status', id: 'a', status: 'encoding' }, { type: 'cancel', id: 'a' });
    expect(queueReducer(cancelled, { type: 'phase', id: 'a', phase: 'detail' })).toBe(cancelled);
    expect(queueReducer(cancelled, { type: 'small', id: 'a', longEdge: 900 })).toBe(cancelled);
  });

  it('the warning survives to done and is reset by a full retry', () => {
    const small = run(add, { type: 'status', id: 'a', status: 'encoding' }, { type: 'small', id: 'a', longEdge: 1600 });
    expect(first(queueReducer(small, { type: 'status', id: 'a', status: 'done' })).smallEdge).toBe(1600);
    const failed = queueReducer(small, { type: 'fail', id: 'a', failure: { kind: 'upload', message: 'x' } });
    expect(first(queueReducer(failed, { type: 'retry', id: 'a', to: 'uploaded' })).smallEdge).toBe(1600);
    expect(first(queueReducer(failed, { type: 'retry', id: 'a', to: 'queued' })).smallEdge).toBeNull();
  });

  it('the step label names the phase', () => {
    const base = { paused: false, failure: null } as const;
    expect(stepLabel({ ...base, status: 'encoding', phase: 'previews' })).toBe('Připravuji náhledy');
    expect(stepLabel({ ...base, status: 'encoding', phase: 'detail' })).toBe('Nahrávám detail');
    expect(stepLabel({ ...base, status: 'encoding', phase: null })).toBe('Zpracovávám');
    expect(stepLabel({ ...base, status: 'encoded', phase: 'detail' })).toBe('Zpracovávám');
  });
});
