/**
 * Queue state as a pure reducer. Terminal items (done, failed, cancelled) never change except through
 * `retry` or `remove`, so a late async result after a cancel cannot resurrect an item.
 */
import { isTerminal, type EncodePhase, type ItemFailure, type ItemStatus, type QueueItem, type QueueState } from './types';

export type QueueAction =
  | { type: 'add'; items: ReadonlyArray<Pick<QueueItem, 'id' | 'albumId' | 'name' | 'size'>> }
  | { type: 'status'; id: string; status: Exclude<ItemStatus, 'queued' | 'failed' | 'cancelled'> }
  | { type: 'progress'; id: string; progress: number }
  | { type: 'paused'; id: string; paused: boolean }
  /** The encoder started a set (only while the item is 'encoding'). */
  | { type: 'phase'; id: string; phase: EncodePhase }
  /** Source long edge below the detail minimum (px); a warning on the row. */
  | { type: 'small'; id: string; longEdge: number }
  | { type: 'fail'; id: string; failure: ItemFailure }
  | { type: 'cancel'; id: string }
  /** failed or cancelled -> queued (full redo) or uploaded (only the commit is repeated). */
  | { type: 'retry'; id: string; to: 'queued' | 'uploaded' }
  | { type: 'remove'; id: string }
  | { type: 'online'; online: boolean };

export const initialQueueState: QueueState = { items: [], online: true, nextOrder: 0 };

/** Stages that need the network: these show "Čekám na připojení…" while offline. */
const NETWORK_STATUSES: readonly ItemStatus[] = ['encoded', 'reserving', 'reserved', 'uploading', 'uploaded', 'committing'];

function patch(state: QueueState, id: string, change: (item: QueueItem) => QueueItem): QueueState {
  let touched = false;
  const items = state.items.map((item) => {
    if (item.id !== id) return item;
    const next = change(item);
    if (next !== item) touched = true;
    return next;
  });
  return touched ? { ...state, items } : state;
}

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case 'add': {
      let order = state.nextOrder;
      const known = new Set(state.items.map((i) => i.id));
      const added: QueueItem[] = action.items
        .filter((i) => !known.has(i.id))
        .map((i) => ({
          ...i,
          order: order++,
          status: 'queued' as const,
          progress: 0,
          paused: false,
          failure: null,
          phase: null,
          smallEdge: null,
        }));
      return added.length === 0 ? state : { ...state, items: [...state.items, ...added], nextOrder: order };
    }
    case 'status':
      return patch(state, action.id, (item) =>
        isTerminal(item.status) || item.status === action.status
          ? item
          : {
              ...item,
              status: action.status,
              phase: null,
              progress: action.status === 'uploading' ? 0 : action.status === 'uploaded' ? 1 : item.progress,
              paused: !state.online && NETWORK_STATUSES.includes(action.status),
            },
      );
    case 'progress':
      return patch(state, action.id, (item) =>
        item.status === 'uploading' && item.progress !== action.progress ? { ...item, progress: action.progress } : item,
      );
    case 'paused':
      return patch(state, action.id, (item) =>
        isTerminal(item.status) || item.paused === action.paused ? item : { ...item, paused: action.paused },
      );
    case 'phase':
      return patch(state, action.id, (item) =>
        item.status === 'encoding' && item.phase !== action.phase ? { ...item, phase: action.phase } : item,
      );
    case 'small':
      return patch(state, action.id, (item) =>
        isTerminal(item.status) || item.smallEdge === action.longEdge ? item : { ...item, smallEdge: action.longEdge },
      );
    case 'fail':
      return patch(state, action.id, (item) =>
        isTerminal(item.status) ? item : { ...item, status: 'failed', paused: false, failure: action.failure, phase: null },
      );
    case 'cancel':
      return patch(state, action.id, (item) =>
        isTerminal(item.status) ? item : { ...item, status: 'cancelled', paused: false, failure: null, phase: null },
      );
    case 'retry':
      return patch(state, action.id, (item) =>
        item.status === 'failed' || item.status === 'cancelled'
          ? {
              ...item,
              status: action.to,
              progress: action.to === 'uploaded' ? 1 : 0,
              paused: false,
              failure: null,
              phase: null,
              smallEdge: action.to === 'queued' ? null : item.smallEdge,
            }
          : item,
      );
    case 'remove': {
      const items = state.items.filter((i) => !(i.id === action.id && isTerminal(i.status)));
      return items.length === state.items.length ? state : { ...state, items };
    }
    case 'online':
      if (state.online === action.online) return state;
      return {
        ...state,
        online: action.online,
        items: state.items.map((item) =>
          NETWORK_STATUSES.includes(item.status) && item.paused !== !action.online ? { ...item, paused: !action.online } : item,
        ),
      };
  }
}

export interface QueueSummary {
  total: number;
  done: number;
  failed: number;
  cancelled: number;
  /** Not finished and not failed: queued or in some stage. */
  active: number;
}

export function summarize(state: QueueState): QueueSummary {
  const count = (pick: (i: QueueItem) => boolean) => state.items.filter(pick).length;
  return {
    total: state.items.length,
    done: count((i) => i.status === 'done'),
    failed: count((i) => i.status === 'failed'),
    cancelled: count((i) => i.status === 'cancelled'),
    active: count((i) => !isTerminal(i.status)),
  };
}
