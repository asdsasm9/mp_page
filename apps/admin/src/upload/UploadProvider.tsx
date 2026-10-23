/**
 * App-level owner of the upload queue (ADMIN-UX 3.5, plan 4.6): it lives above the router outlet, so the queue
 * survives navigation. It wires the framework-free queue to the app: ports, the session (a 401 opens the login
 * modal), `useCommitUpload` (storage bar, publish dot and photo lists refresh after each commit), the app_config
 * limits, the auto cover, online/offline events, beforeunload, the screen wake lock and the toasts.
 *
 * State is split in two contexts: the changing state (queue rows, notices) and stable actions, so screens that only
 * start uploads do not re-render on every progress tick.
 */
import type { AppConfigRow, PhotoRow } from '@mp/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useSession } from '../auth/session';
import { useToast } from '../components/Toast';
import { catalogKeys } from '../data/catalog';
import { isOnline } from '../data/health';
import { usePhotoActions } from '../data/photoActions';
import { storageKeys, useCommitUpload } from '../data/storage';
import { createCanvasSurfaceFactory, createEncoder, inspectInput, type Dimensions } from '../encode';
import { messageForCode } from '../i18n/messages';
import { usePorts } from '../ports-context';
import { fingerprint, intakeFiles } from './intake';
import { createUploadQueue, encodeConcurrencyFor, type QueueConfig, type UploadQueue } from './queue';
import { initialQueueState, summarize } from './reducer';
import { finishedToast, storageVerdict } from './summary';
import { cs } from '../i18n/cs';
import type { Encoder, ItemFailure, QueueState } from './types';

/** app_config is re-read at most this often when files are picked. */
const CONFIG_STALE_MS = 60_000;

export interface Rejection {
  key: string;
  albumId: string;
  name: string;
  message: string;
}

export interface DuplicatePrompt {
  albumId: string;
  files: File[];
}

/** Result of the replace-photo pre-check: the same intake and input guard as a normal upload, nothing is sent. */
export type ReplacementCheck = { ok: true; dimensions: Dimensions | undefined } | { ok: false; message: string };

/** A replacement upload running through the shared queue. `done` rejects with the row's ItemFailure. */
export interface ReplacementUpload {
  id: string;
  done: Promise<PhotoRow>;
}

export interface UploadStateValue {
  queue: QueueState;
  rejections: Rejection[];
  /** A role=alert sentence for the drop zone (storage full, limits not loaded). */
  notice: string | null;
  /** When the current batch began (ms on the app clock): the base of the time estimate. */
  startedAt: number | null;
  drawerOpen: boolean;
  duplicates: DuplicatePrompt | null;
}

export interface UploadActions {
  /** Intake, limits, courtesy pre-check, then queueing. Never throws. */
  submit(albumId: string, files: readonly File[]): Promise<void>;
  /** The answer to the duplicate prompt: true = upload them again, false = skip (default). */
  resolveDuplicates(uploadAgain: boolean): void;
  cancel(id: string): void;
  cancelAll(): void;
  retry(id: string): void;
  retryFailed(): void;
  remove(id: string): void;
  dismissRejection(key: string): void;
  dismissNotice(): void;
  setDrawerOpen(open: boolean): void;
  /** Local object URL of a picked file, until the public image has loaded. */
  previewFor(photoId: string): string | undefined;
  releasePreview(photoId: string): void;
  /** Replace-photo step 1: type, size and header checks of one file. Never queues or sends anything. */
  checkReplacement(file: File): Promise<ReplacementCheck>;
  /**
   * Replace-photo step 2: encodes and uploads the file into `albumId` through the normal queue (new photo id).
   * The row is kept out of the batch toast; `done` resolves with the committed photo.
   */
  startReplacement(albumId: string, file: File): ReplacementUpload | null;
}

const StateContext = createContext<UploadStateValue | null>(null);
const ActionsContext = createContext<UploadActions | null>(null);

const noopSubscribe = () => () => undefined;
const emptyState = () => initialQueueState;

/** Phones and tablets (coarse pointer) encode one photo at a time to save memory. */
function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

function previewUrl(file: Blob): string | undefined {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined;
}

interface Props {
  /** Tests inject a stub; the app uses the canvas encoder. */
  encoder?: Encoder;
  children: ReactNode;
}

export function UploadProvider({ encoder, children }: Props) {
  const ports = usePorts();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const photoActions = usePhotoActions();
  const commitMutation = useCommitUpload();

  // The queue is created once per ports/encoder; callbacks read the newest hooks through this ref.
  const latest = useRef({ session, toast, photoActions, commitMutation });
  latest.current = { session, toast, photoActions, commitMutation };

  const [queue, setQueue] = useState<UploadQueue | null>(null);
  const queueRef = useRef<UploadQueue | null>(null);
  const limits = useRef<Pick<AppConfigRow, 'max_files_per_batch'> | null>(null);
  const known = useRef(new Set<string>());
  const previews = useRef(new Map<string, string>());
  const coverTried = useRef(new Set<string>());
  const wasRunning = useRef(false);
  const counter = useRef(0);
  /** Queue rows that belong to a photo replacement: resolved on commit, never announced as a batch. */
  const replacements = useRef(new Map<string, (photo: PhotoRow) => void>());
  const silent = useRef(new Set<string>());

  const [rejections, setRejections] = useState<Rejection[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicatePrompt | null>(null);
  const duplicatesRef = useRef(duplicates);
  duplicatesRef.current = duplicates;

  useEffect(() => {
    // The limits come from app_config (read when files are picked), never from constants.
    const config: QueueConfig = {
      get maxFilesPerBatch() {
        return limits.current?.max_files_per_batch ?? 1;
      },
      encodeConcurrency: encodeConcurrencyFor(isTouchDevice()),
    };

    /** The first commit into an album gives a cover-less album its cover; once per album and run. */
    const coverAfterCommit = (albumId: string) => {
      if (coverTried.current.has(albumId)) return;
      coverTried.current.add(albumId);
      latest.current.photoActions.ensureCover(albumId).catch(() => {
        coverTried.current.delete(albumId); // try again with the next commit
      });
    };

    const q = createUploadQueue({
      api: {
        reserve: (request) => ports.api.reserve(request),
        commit: (request, options) =>
          latest.current.commitMutation.mutateAsync({ request, ...(options?.signal ? { signal: options.signal } : {}) }),
      },
      upload: ports.upload,
      clock: ports.clock,
      ids: ports.ids,
      encoder: encoder ?? createEncoder(createCanvasSurfaceFactory()),
      config,
      runAuthed: (call) => latest.current.session.runAuthed(call),
      onCommitted: ({ item, photo }) => {
        const resolveReplacement = replacements.current.get(item.id);
        if (resolveReplacement) {
          // The cover of a replacement is handled by the replace sequence, not by the auto cover.
          replacements.current.delete(item.id);
          resolveReplacement(photo);
          return;
        }
        coverAfterCommit(item.albumId);
      },
    });
    queueRef.current = q;
    setQueue(q);

    const syncOnline = () => q.setOnline(isOnline());
    syncOnline();
    window.addEventListener('online', syncOnline);
    window.addEventListener('offline', syncOnline);
    return () => {
      window.removeEventListener('online', syncOnline);
      window.removeEventListener('offline', syncOnline);
      q.dispose();
      if (queueRef.current === q) queueRef.current = null;
    };
  }, [ports, encoder]);

  useEffect(() => {
    const urls = previews.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  // Signing out ends the queue: nothing of one session may carry on (or show) under the next sign-in.
  const signedOut = session.status === 'signedOut';
  useEffect(() => {
    if (!signedOut) return;
    const q = queueRef.current;
    if (q) {
      q.cancelAll();
      for (const item of q.getState().items) q.remove(item.id);
    }
    for (const url of previews.current.values()) URL.revokeObjectURL(url);
    previews.current.clear();
    known.current.clear();
    coverTried.current.clear();
    setRejections([]);
    setNotice(null);
    setDuplicates(null);
    setStartedAt(null);
    setDrawerOpen(false);
  }, [signedOut]);

  const queueState = useSyncExternalStore(queue ? queue.subscribe : noopSubscribe, queue ? queue.getState : emptyState);
  const stateRef = useRef(queueState);
  stateRef.current = queueState;
  const running = summarize(queueState).active > 0;

  // Idle again: one toast for the batch, and the next batch may set a cover again.
  useEffect(() => {
    if (running) {
      wasRunning.current = true;
      return;
    }
    if (!wasRunning.current) return;
    wasRunning.current = false;
    coverTried.current.clear();
    const own = stateRef.current;
    const text = finishedToast({ ...own, items: own.items.filter((i) => !silent.current.has(i.id)) });
    if (text) latest.current.toast.show(text);
    setStartedAt(null);
  }, [running]);

  // Closing the tab while work is pending asks the browser to confirm.
  useEffect(() => {
    if (!running) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [running]);

  // Keep the screen awake while uploading, where the browser allows it (phones).
  useEffect(() => {
    if (!running || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let stopped = false;
    const acquire = () => {
      navigator.wakeLock.request('screen').then(
        (lock) => {
          if (stopped) void lock.release().catch(() => undefined);
          else sentinel = lock;
        },
        () => undefined, // refused (battery saver, hidden tab): uploading works without it
      );
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && (sentinel === null || sentinel.released)) acquire();
    };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [running]);

  const actions = useMemo<UploadActions>(() => {
    const enqueue = (albumId: string, files: File[]) => {
      const q = queueRef.current;
      if (!q || files.length === 0) return;
      const before = q.getState();
      if (summarize(before).active === 0) {
        // A new batch into an idle queue starts a fresh list: the photos finished last time leave it.
        for (const item of before.items) if (item.status === 'done') q.remove(item.id);
        setStartedAt(ports.clock.now());
      }
      const ids = q.add(albumId, files);
      ids.forEach((id, i) => {
        const file = files[i]!;
        known.current.add(fingerprint(albumId, file));
        const url = previewUrl(file);
        if (url) previews.current.set(id, url);
      });
      setDrawerOpen(true);
    };

    /** app_config (cached for a minute); null when it cannot be read. The batch limit is remembered for the queue. */
    const loadConfig = async (): Promise<AppConfigRow | null> => {
      const { session: s } = latest.current;
      try {
        const config = await queryClient.fetchQuery({
          queryKey: catalogKeys.appConfig(),
          queryFn: () => s.runAuthed(() => ports.catalog.getAppConfig()),
          staleTime: CONFIG_STALE_MS,
          networkMode: 'always', // offline: fail at once instead of waiting for the connection
        });
        limits.current = { max_files_per_batch: config.max_files_per_batch };
        return config;
      } catch {
        return null;
      }
    };

    return {
      async checkReplacement(file) {
        const config = await loadConfig();
        if (!config) return { ok: false, message: cs.upload.limitsFailed };
        const intake = intakeFiles([file], { albumId: '', limits: { maxUploadBytes: config.max_upload_bytes } });
        const refused = intake.rejected[0];
        if (refused) return { ok: false, message: refused.message };
        try {
          return { ok: true, dimensions: await inspectInput(file) };
        } catch (error) {
          const text = (error as { userMessage?: unknown } | null)?.userMessage;
          return { ok: false, message: typeof text === 'string' ? text : cs.upload.corrupt };
        }
      },
      startReplacement(albumId, file) {
        const q = queueRef.current;
        if (!q) return null;
        const [id] = q.add(albumId, [file]);
        if (id === undefined) return null;
        silent.current.add(id);
        const done = new Promise<PhotoRow>((resolve, reject) => {
          let unsubscribe: () => void = () => undefined;
          const finish = () => {
            unsubscribe();
            replacements.current.delete(id);
            queueMicrotask(() => q.remove(id)); // the row is not part of the batch list
          };
          replacements.current.set(id, (photo) => {
            finish();
            resolve(photo);
          });
          unsubscribe = q.subscribe(() => {
            const item = q.getState().items.find((i) => i.id === id);
            if (!item) return;
            if (item.status === 'failed' || item.status === 'cancelled') {
              finish();
              const failure: ItemFailure = item.failure ?? { kind: 'corrupt', message: cs.upload.cancelled };
              reject(failure);
            }
          });
        });
        return { id, done };
      },
      async submit(albumId, picked) {
        if (!queueRef.current || picked.length === 0) return;
        setNotice(null);
        const { session: s } = latest.current;
        const config = await loadConfig();
        if (!config) {
          setNotice(cs.upload.limitsFailed);
          return;
        }

        const result = intakeFiles(picked, {
          albumId,
          limits: { maxUploadBytes: config.max_upload_bytes },
          known: known.current,
        });
        if (result.rejected.length > 0) {
          setDrawerOpen(true);
          setRejections((current) => [
            ...current,
            ...result.rejected.map((r) => ({
              key: `${r.file.name}|${r.file.size}|${(counter.current += 1)}`,
              albumId,
              name: r.file.name,
              message: r.message,
            })),
          ]);
        }

        let accepted = result.accepted;
        let duplicated = result.duplicates;
        if (accepted.length + duplicated.length > 0) {
          // Courtesy only: the server decides. A failing read here never blocks the upload.
          try {
            const storage = await queryClient.fetchQuery({
              queryKey: storageKeys.all,
              queryFn: () => s.runAuthed(() => ports.api.getStorage()),
              staleTime: 0,
              networkMode: 'always',
            });
            if (storageVerdict(storage) === 'full') {
              setNotice(messageForCode('STORAGE_FULL'));
              accepted = [];
              duplicated = [];
            }
          } catch {
            /* the server decides */
          }
        }
        enqueue(albumId, accepted);
        if (duplicated.length > 0) setDuplicates({ albumId, files: duplicated });
      },
      resolveDuplicates(uploadAgain) {
        const prompt = duplicatesRef.current;
        setDuplicates(null);
        if (uploadAgain && prompt) enqueue(prompt.albumId, prompt.files);
      },
      cancel: (id) => queueRef.current?.cancel(id),
      cancelAll: () => queueRef.current?.cancelAll(),
      retry: (id) => queueRef.current?.retry(id),
      retryFailed: () => queueRef.current?.retryFailed(),
      remove: (id) => queueRef.current?.remove(id),
      dismissRejection: (key) => setRejections((current) => current.filter((r) => r.key !== key)),
      dismissNotice: () => setNotice(null),
      setDrawerOpen,
      previewFor: (photoId) => previews.current.get(photoId),
      releasePreview(photoId) {
        const url = previews.current.get(photoId);
        if (url === undefined) return;
        previews.current.delete(photoId);
        URL.revokeObjectURL(url);
      },
    };
  }, [ports, queryClient]);

  const state = useMemo<UploadStateValue>(
    () => ({ queue: queueState, rejections, notice, startedAt, drawerOpen, duplicates }),
    [queueState, rejections, notice, startedAt, drawerOpen, duplicates],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

export function useUploadState(): UploadStateValue {
  const value = useContext(StateContext);
  if (!value) throw new Error('useUploadState outside UploadProvider');
  return value;
}

export function useUploadActions(): UploadActions {
  const value = useContext(ActionsContext);
  if (!value) throw new Error('useUploadActions outside UploadProvider');
  return value;
}

/** For components that also render without the provider (the photo grid in isolation). */
export function useUploadActionsOptional(): UploadActions | null {
  return useContext(ActionsContext);
}
