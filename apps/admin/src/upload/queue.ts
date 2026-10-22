/**
 * Upload scheduler (plan 4.6). Framework-free: ports, clock, ids and the encoder are injected, so tests run it with
 * fake timers and stubs.
 *
 * Pipeline per photo: encode (fully, so the exact bytes are known) -> reserve (groups) -> PUT every file -> commit
 * (strictly in selection order). Rules:
 *  - encode concurrency from config (1 on touch, 2 on desktop); encoded photos held in memory never exceed 3;
 *  - reserve groups: at most 10 photos (never above max_files_per_batch) or after 1 s without a new encoded photo;
 *    a refused photo does not stop the others; a request refused as a whole (409 STORAGE_FULL) stops all encoding;
 *  - at most 3 photos upload at once, each with 4 parallel PUTs, headers exactly as signed;
 *  - transient failures (network, 5xx, 429, 401) wait 1 s, 3 s, 9 s and then fail the photo; other 4xx are never
 *    retried; offline pauses ("Čekám na připojení…") without using up an attempt;
 *  - an expired upload URL (403) triggers one silent re-reserve per photo;
 *  - cancel aborts the XHRs; the objects already written are left to reconcile.
 */
import {
  sumBytes,
  type CommitRequest,
  type PhotoRow,
  type ReserveRequest,
  type ReserveResponse,
  type UploadTarget,
} from '@mp/shared';
import { cs } from '../i18n/cs';
import { errorCode, errorMessage, messageForCode } from '../i18n/messages';
import {
  ApiError,
  NetworkError,
  UploadAbortedError,
  UploadHttpError,
  type ApiPort,
  type Clock,
  type Ids,
  type UploadPort,
} from '../ports';
import { initialQueueState, queueReducer, type QueueAction } from './reducer';
import {
  isTerminal,
  type EncodedFile,
  type EncodedPhoto,
  type Encoder,
  type FileLike,
  type ItemFailure,
  type QueueItem,
  type QueueState,
} from './types';

export const GROUP_SIZE = 10;
export const GROUP_IDLE_MS = 1000;
export const ENCODE_BUFFER = 3;
export const UPLOAD_PARALLEL = 3;
export const PUT_PARALLEL = 4;
export const BACKOFF_MS = [1000, 3000, 9000] as const;

/** Encode concurrency: one on touch devices (memory), two on desktop. */
export const encodeConcurrencyFor = (touch: boolean): number => (touch ? 1 : 2);

export interface QueueConfig {
  /** app_config.max_files_per_batch */
  maxFilesPerBatch: number;
  encodeConcurrency: number;
}

export interface CommittedEvent {
  item: QueueItem;
  photo: PhotoRow;
  alreadyExisted: boolean;
}

export interface QueueDeps {
  /** `commit` receives the photo's abort signal (cancel aborts an in-flight commit). */
  api: Pick<ApiPort, 'reserve' | 'commit'>;
  upload: UploadPort;
  clock: Clock;
  ids: Ids;
  encoder: Encoder;
  config: QueueConfig;
  /** Wraps every Worker call so a 401 can open the login modal and repeat the call (default: call directly). */
  runAuthed?: <T>(call: () => Promise<T>) => Promise<T>;
  /** Extra online check (navigator.onLine); the queue's own `setOnline` flag always applies. */
  isOnline?: () => boolean;
  onCommitted?: (event: CommittedEvent) => void;
}

export interface UploadQueue {
  getState(): QueueState;
  subscribe(listener: () => void): () => void;
  /** Queues files that already passed intake, in the order given (the selection order). Returns the photo ids. */
  add(albumId: string, files: readonly FileLike[]): string[];
  cancel(id: string): void;
  cancelAll(): void;
  /** Failed or cancelled -> tries again (only the commit when the photo was already uploaded). */
  retry(id: string): void;
  retryFailed(): void;
  remove(id: string): void;
  setOnline(online: boolean): void;
  dispose(): void;
}

/** Per-photo runtime data that is not part of the serializable state. */
interface Run {
  file: FileLike;
  controller: AbortController;
  encoded?: EncodedPhoto;
  targets?: UploadTarget[];
  reReserved: boolean;
  uploadedKeys: Set<string>;
  commit?: CommitRequest;
}

class Cancelled extends Error {
  constructor() {
    super('CANCELLED');
  }
}
class UrlExpired extends Error {
  constructor() {
    super('URL_EXPIRED');
  }
}

const fileKey = (f: { kind: string; tier?: number | undefined }) => `${f.kind}:${f.tier ?? ''}`;

/** Transient: worth another try after a wait. Everything else (other 4xx) fails at once. */
function isTransientApi(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  if (error instanceof ApiError) return error.status === 401 || error.status === 429 || error.status >= 500;
  return false;
}

export function createUploadQueue(deps: QueueDeps): UploadQueue {
  const runAuthed = deps.runAuthed ?? (<T>(call: () => Promise<T>) => call());
  const master = new AbortController();
  const runs = new Map<string, Run>();
  const listeners = new Set<() => void>();
  const onlineWaiters = new Set<() => void>();
  let state: QueueState = initialQueueState;
  let disposed = false;
  let reserveBusy = false;
  let commitBusy = false;
  let idleTimer: AbortController | null = null;
  /** Set when the browser cannot write WebP: nothing more is encoded until the photographer retries. */
  let noWebp: ItemFailure | null = null;

  const online = () => state.online && (deps.isOnline?.() ?? true);

  function dispatch(action: QueueAction) {
    const next = queueReducer(state, action);
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener();
  }

  const itemOf = (id: string) => state.items.find((i) => i.id === id);
  const inOrder = (status: QueueItem['status']) =>
    state.items.filter((i) => i.status === status).sort((a, b) => a.order - b.order);

  function fail(id: string, failure: ItemFailure) {
    dispatch({ type: 'fail', id, failure });
    const run = runs.get(id);
    if (run) {
      run.controller.abort();
      delete run.encoded; // free the blobs
    }
  }

  function failureOf(error: unknown, stage: 'upload' | 'commit' | 'server'): ItemFailure {
    if (error instanceof ApiError) {
      const kind = error.code === 'STORAGE_FULL' ? 'storage-full' : error.code === 'FILE_TOO_LARGE' ? 'too-large' : stage;
      return { kind, message: errorMessage(error), code: error.code };
    }
    if (error instanceof UploadHttpError || error instanceof NetworkError) {
      return { kind: stage, message: messageForCode('UPLOAD_FAILED'), code: errorCode(error) };
    }
    return { kind: stage, message: messageForCode('UNKNOWN'), code: errorCode(error) };
  }

  // ------------------------------------------------------------------ waiting for the network

  function waitOnline(ids: readonly string[], signal: AbortSignal): Promise<void> {
    for (const id of ids) dispatch({ type: 'paused', id, paused: true });
    return new Promise<void>((resolve, reject) => {
      const wake = () => {
        cleanup();
        for (const id of ids) dispatch({ type: 'paused', id, paused: false });
        resolve();
      };
      const onAbort = () => {
        cleanup();
        reject(new Cancelled());
      };
      const cleanup = () => {
        onlineWaiters.delete(check);
        signal.removeEventListener('abort', onAbort);
      };
      const check = () => {
        if (online()) wake();
      };
      if (signal.aborted) return onAbort();
      onlineWaiters.add(check);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** One Worker call with the retry rules; `ids` are the photos shown as waiting while offline. */
  async function callWithRetry<T>(call: () => Promise<T>, ids: readonly string[], signal: AbortSignal): Promise<T> {
    let failures = 0;
    for (;;) {
      if (signal.aborted) throw new Cancelled();
      try {
        return await runAuthed(call);
      } catch (error) {
        if (signal.aborted) throw new Cancelled();
        if (!isTransientApi(error)) throw error;
        if (error instanceof NetworkError && !online()) {
          await waitOnline(ids, signal);
          continue;
        }
        if (failures >= BACKOFF_MS.length) throw error;
        await sleep(BACKOFF_MS[failures]!, signal);
        failures += 1;
      }
    }
  }

  async function sleep(ms: number, signal: AbortSignal) {
    try {
      await deps.clock.sleep(ms, signal);
    } catch {
      throw new Cancelled();
    }
  }

  // ------------------------------------------------------------------ the scheduler

  function pump() {
    if (disposed) return;
    startEncodes();
    maybeFlush();
    startUploads();
    startCommit();
  }

  // -- encode

  function startEncodes() {
    if (noWebp) {
      for (const item of inOrder('queued')) fail(item.id, noWebp);
      return;
    }
    let encoding = state.items.filter((i) => i.status === 'encoding').length;
    const buffered = state.items.filter((i) => i.status === 'encoded' || i.status === 'reserving' || i.status === 'reserved').length;
    for (const item of inOrder('queued')) {
      if (encoding >= deps.config.encodeConcurrency || encoding + buffered >= ENCODE_BUFFER) break;
      encoding += 1;
      void runEncode(item.id);
    }
  }

  async function runEncode(id: string) {
    const run = runs.get(id);
    if (!run) return;
    run.controller = new AbortController();
    const signal = run.controller.signal;
    dispatch({ type: 'status', id, status: 'encoding' });
    try {
      const encoded = await deps.encoder.encode(run.file, signal);
      if (signal.aborted || itemOf(id)?.status !== 'encoding') return;
      run.encoded = encoded;
      dispatch({ type: 'status', id, status: 'encoded' });
      restartIdleTimer();
    } catch (error) {
      if (!signal.aborted) {
        // The browser encoder throws errors that carry their own Czech text (src/encode/errors.ts).
        const text = (error as { userMessage?: unknown } | null)?.userMessage;
        const code = (error as { code?: unknown } | null)?.code;
        const failure: ItemFailure = {
          kind: 'corrupt',
          message: typeof text === 'string' ? text : cs.upload.corrupt,
          ...(typeof code === 'string' ? { code } : {}),
        };
        fail(id, failure);
        // A browser without WebP fails every file the same way: say it once and stop trying.
        if (code === 'NO_WEBP') noWebp = failure;
      }
    }
    pump();
  }

  // -- reserve

  const groupSize = () => Math.max(1, Math.min(GROUP_SIZE, deps.config.maxFilesPerBatch));

  function nextGroup(): QueueItem[] {
    const waiting = inOrder('encoded');
    const first = waiting[0];
    if (!first) return [];
    return waiting.filter((i) => i.albumId === first.albumId).slice(0, groupSize());
  }

  function maybeFlush() {
    if (reserveBusy || !online()) return;
    const group = nextGroup();
    if (group.length === 0) {
      stopIdleTimer();
      return;
    }
    if (group.length >= groupSize()) {
      stopIdleTimer();
      void reserveGroup(group);
    } else if (!idleTimer) {
      restartIdleTimer();
    }
  }

  function stopIdleTimer() {
    idleTimer?.abort();
    idleTimer = null;
  }

  function restartIdleTimer() {
    stopIdleTimer();
    const timer = new AbortController();
    idleTimer = timer;
    deps.clock.sleep(GROUP_IDLE_MS, timer.signal).then(
      () => {
        if (disposed || idleTimer !== timer) return;
        idleTimer = null;
        if (reserveBusy || !online()) return pump();
        const group = nextGroup();
        if (group.length > 0) void reserveGroup(group);
      },
      () => undefined,
    );
  }

  function reserveItemOf(id: string): ReserveRequest['items'][number] | null {
    const encoded = runs.get(id)?.encoded;
    if (!encoded) return null;
    return {
      photo_id: id,
      width: encoded.width,
      height: encoded.height,
      files: encoded.files.map((f) => (f.tier === undefined ? { kind: f.kind, bytes: f.bytes } : { kind: f.kind, tier: f.tier, bytes: f.bytes })),
    };
  }

  async function reserveGroup(group: QueueItem[]) {
    reserveBusy = true;
    const ids = group.map((i) => i.id);
    for (const id of ids) dispatch({ type: 'status', id, status: 'reserving' });
    const items = ids.map(reserveItemOf).filter((i): i is NonNullable<typeof i> => i !== null);
    const request: ReserveRequest = { album_id: group[0]!.albumId, items };
    try {
      const response = await callWithRetry(() => deps.api.reserve(request), ids, master.signal);
      applyReserve(ids, response);
    } catch (error) {
      if (!(error instanceof Cancelled)) {
        if (error instanceof ApiError && error.code === 'STORAGE_FULL') storageFull(ids);
        else for (const id of ids) fail(id, failureOf(error, 'server'));
      }
    }
    reserveBusy = false;
    pump();
  }

  function applyReserve(ids: readonly string[], response: ReserveResponse) {
    const byId = new Map(response.items.map((r) => [r.photo_id, r] as const));
    const refused: string[] = [];
    let accepted = 0;
    for (const id of ids) {
      if (itemOf(id)?.status !== 'reserving') continue; // cancelled meanwhile
      const result = byId.get(id);
      if (result?.ok && result.uploads) {
        const run = runs.get(id);
        if (run) run.targets = result.uploads;
        dispatch({ type: 'status', id, status: 'reserved' });
        accepted += 1;
      } else if (result?.code === 'FILE_TOO_LARGE') {
        fail(id, { kind: 'too-large', message: cs.upload.tooLarge, code: 'FILE_TOO_LARGE' });
      } else if (result?.code === 'STORAGE_FULL') {
        refused.push(id);
      } else {
        fail(id, { kind: 'server', message: messageForCode('UNKNOWN') });
      }
    }
    if (accepted === 0 && refused.length > 0) storageFull(ids);
    else for (const id of refused) fail(id, storageFullFailure());
  }

  const storageFullFailure = (): ItemFailure => ({
    kind: 'storage-full',
    message: messageForCode('STORAGE_FULL'),
    code: 'STORAGE_FULL',
  });

  /** The whole request was refused: nothing more would fit, so stop encoding and fail everything not yet uploading. */
  function storageFull(ids: readonly string[]) {
    for (const id of ids) fail(id, storageFullFailure());
    for (const item of state.items) {
      if (['queued', 'encoding', 'encoded', 'reserving', 'reserved'].includes(item.status)) fail(item.id, storageFullFailure());
    }
  }

  // -- upload

  function startUploads() {
    if (!online()) return;
    let uploading = state.items.filter((i) => i.status === 'uploading').length;
    for (const item of inOrder('reserved')) {
      if (uploading >= UPLOAD_PARALLEL) break;
      uploading += 1;
      void runUpload(item.id);
    }
  }

  async function runUpload(id: string) {
    const run = runs.get(id);
    if (!run?.encoded) return;
    run.controller = new AbortController();
    const signal = run.controller.signal;
    dispatch({ type: 'status', id, status: 'uploading' });
    try {
      for (;;) {
        try {
          await putRound(id, run, signal);
          break;
        } catch (error) {
          if (!(error instanceof UrlExpired) || run.reReserved) throw error;
          run.reReserved = true;
          await reReserve(id, run, signal);
        }
      }
      if (signal.aborted) return;
      run.commit = commitRequestOf(id, run.encoded);
      delete run.encoded; // the blobs are no longer needed
      dispatch({ type: 'status', id, status: 'uploaded' });
    } catch (error) {
      if (!(error instanceof Cancelled) && !signal.aborted) fail(id, failureOf(error, 'upload'));
    }
    pump();
  }

  async function reReserve(id: string, run: Run, signal: AbortSignal) {
    const item = reserveItemOf(id);
    const albumId = itemOf(id)?.albumId;
    if (!item || !albumId) throw new Cancelled();
    const response = await callWithRetry(() => deps.api.reserve({ album_id: albumId, items: [item] }), [id], signal);
    const result = response.items.find((r) => r.photo_id === id);
    if (!result?.ok || !result.uploads) {
      throw new ApiError(result?.code ?? 'INTERNAL');
    }
    run.targets = result.uploads;
  }

  /** Uploads every file not yet stored, 4 PUTs at a time; the first error aborts the siblings and is rethrown. */
  async function putRound(id: string, run: Run, signal: AbortSignal) {
    const encoded = run.encoded!;
    const targets = new Map((run.targets ?? []).map((t) => [fileKey(t), t] as const));
    const todo = encoded.files.filter((f) => !run.uploadedKeys.has(fileKey(f)));
    const totalBytes = encoded.files.reduce((sum, f) => sum + f.bytes, 0) || 1;
    const loaded = new Map<string, number>();
    for (const f of encoded.files) if (run.uploadedKeys.has(fileKey(f))) loaded.set(fileKey(f), f.bytes);
    const round = new AbortController();
    const onAbort = () => round.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    let firstError: unknown = null;
    let next = 0;

    const worker = async () => {
      while (next < todo.length && firstError === null) {
        const file = todo[next++]!;
        const target = targets.get(fileKey(file));
        try {
          if (!target) throw new ApiError('INTERNAL');
          await putWithRetry(id, run, target, file, round.signal, (n) => {
            loaded.set(fileKey(file), n);
            const sum = [...loaded.values()].reduce((a, b) => a + b, 0);
            dispatch({ type: 'progress', id, progress: Math.min(1, sum / totalBytes) });
          });
          loaded.set(fileKey(file), file.bytes);
          run.uploadedKeys.add(fileKey(file));
        } catch (error) {
          if (firstError === null) firstError = error;
          round.abort();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PUT_PARALLEL, todo.length) }, worker));
    signal.removeEventListener('abort', onAbort);
    if (signal.aborted) throw new Cancelled();
    if (firstError !== null) throw firstError;
  }

  async function putWithRetry(
    id: string,
    run: Run,
    target: UploadTarget,
    file: EncodedFile,
    signal: AbortSignal,
    onProgress: (loaded: number) => void,
  ) {
    let failures = 0;
    for (;;) {
      if (signal.aborted) throw new Cancelled();
      if (Date.parse(target.expiresAt) <= deps.clock.now() && !run.reReserved) throw new UrlExpired();
      try {
        // The signed headers go out exactly as issued; content-length is never set here.
        await deps.upload.put({ url: target.url, method: target.method, headers: target.headers }, file.body, {
          signal,
          onProgress: (loaded) => onProgress(loaded),
        });
        return;
      } catch (error) {
        if (signal.aborted || error instanceof UploadAbortedError) throw new Cancelled();
        if (error instanceof UploadHttpError && error.status === 403 && !run.reReserved) throw new UrlExpired();
        const transient =
          error instanceof NetworkError ||
          (error instanceof UploadHttpError && (error.status === 403 || error.status === 429 || error.status >= 500));
        if (!transient) throw error;
        if (error instanceof NetworkError && !online()) {
          await waitOnline([id], signal);
          continue;
        }
        if (failures >= BACKOFF_MS.length) throw error;
        await sleep(BACKOFF_MS[failures]!, signal);
        failures += 1;
      }
    }
  }

  // -- commit

  function commitRequestOf(id: string, encoded: EncodedPhoto): CommitRequest {
    return {
      photo_id: id,
      album_id: itemOf(id)!.albumId,
      width: encoded.width,
      height: encoded.height,
      ...(encoded.dominantColor === undefined ? {} : { dominant_color: encoded.dominantColor }),
      variants: encoded.variants,
      bytes_total: sumBytes(encoded.variants),
    };
  }

  /** Strictly in selection order: the lowest-order photo that is not finished must be the one that is ready. */
  function startCommit() {
    if (commitBusy || !online()) return;
    const head = state.items.filter((i) => !isTerminal(i.status)).sort((a, b) => a.order - b.order)[0];
    if (head?.status === 'uploaded') void runCommit(head.id);
  }

  async function runCommit(id: string) {
    const run = runs.get(id);
    if (!run?.commit) return;
    commitBusy = true;
    run.controller = new AbortController();
    const signal = run.controller.signal;
    const request = run.commit;
    dispatch({ type: 'status', id, status: 'committing' });
    try {
      // The signal aborts an in-flight commit on cancel; the Worker's commit is idempotent, so a commit that
      // already arrived is harmless and a retry reports already_existed.
      const response = await callWithRetry(() => deps.api.commit(request, { signal }), [id], signal);
      if (itemOf(id)?.status === 'committing') {
        dispatch({ type: 'status', id, status: 'done' });
        delete run.commit;
        deps.onCommitted?.({ item: itemOf(id)!, photo: response.photo, alreadyExisted: response.already_existed });
      }
    } catch (error) {
      if (!(error instanceof Cancelled) && !signal.aborted) fail(id, failureOf(error, 'commit'));
    }
    commitBusy = false;
    pump();
  }

  // ------------------------------------------------------------------ public API

  function cancelOne(id: string) {
    runs.get(id)?.controller.abort();
    dispatch({ type: 'cancel', id });
    const run = runs.get(id);
    if (run) delete run.encoded;
  }

  const api: UploadQueue = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    add(albumId, files) {
      const added = files.map((file) => ({ id: deps.ids.uuid(), albumId, name: file.name, size: file.size, file }));
      for (const a of added) {
        runs.set(a.id, { file: a.file, controller: new AbortController(), reReserved: false, uploadedKeys: new Set() });
      }
      dispatch({ type: 'add', items: added.map(({ id, albumId: album, name, size }) => ({ id, albumId: album, name, size })) });
      pump();
      return added.map((a) => a.id);
    },
    cancel(id) {
      cancelOne(id);
      pump();
    },
    cancelAll() {
      for (const item of state.items) if (!isTerminal(item.status)) cancelOne(item.id);
      pump();
    },
    retry(id) {
      const item = itemOf(id);
      const run = runs.get(id);
      if (!item || !run || (item.status !== 'failed' && item.status !== 'cancelled')) return;
      if (item.failure?.code === 'NO_WEBP') noWebp = null; // one new attempt shows whether the browser can do it now
      // A failed commit is repeated alone; everything else starts over (the reservation may have expired).
      const commitOnly = item.failure?.kind === 'commit' && run.commit !== undefined && item.failure.code !== 'KEY_MISMATCH' && item.failure.code !== 'BYTES_MISMATCH';
      if (!commitOnly) {
        delete run.commit;
        delete run.targets;
        run.uploadedKeys = new Set();
        run.reReserved = false;
      }
      run.controller = new AbortController();
      dispatch({ type: 'retry', id, to: commitOnly ? 'uploaded' : 'queued' });
      pump();
    },
    retryFailed() {
      for (const item of state.items.filter((i) => i.status === 'failed')) api.retry(item.id);
    },
    remove(id) {
      dispatch({ type: 'remove', id });
      if (!itemOf(id)) runs.delete(id);
    },
    setOnline(value) {
      dispatch({ type: 'online', online: value });
      for (const wake of [...onlineWaiters]) wake();
      pump();
    },
    dispose() {
      disposed = true;
      master.abort();
      stopIdleTimer();
      for (const run of runs.values()) run.controller.abort();
      listeners.clear();
      onlineWaiters.clear();
    },
  };
  return api;
}
