/** Shared state and failure injection of the fake world. Adapters in this folder are views onto it. */
import type {
  AlbumRow,
  CategoryRow,
  ChangeLogRow,
  Limits,
  PhotoRow,
  PublishLogRow,
  SiteSettingsRow,
  SiteStateRow,
} from '@mp/shared';
import {
  ApiError,
  NetworkError,
  type ApiPort,
  type CallbackError,
  type CatalogPort,
  type Clock,
  type Ids,
  type PublishStatus,
} from '../../ports';

export type FakeOp =
  | 'auth.signInWithGoogle'
  | 'auth.signOut'
  | 'auth.getSession'
  | 'auth.isAdmin'
  | `catalog.${Extract<keyof CatalogPort, string>}`
  | `api.${Extract<keyof ApiPort, string>}`
  | 'upload.put'
  | 'publishStatus.read';

export interface FakeUser {
  id: string;
  email: string;
  isAdmin: boolean;
}

export interface FakeObject {
  bytes: number;
  uploadedAtMs: number;
}

export interface FakeGrant {
  key: string;
  headers: Record<string, string>;
  contentLength: number;
  expiresAtMs: number;
}

export interface FakeSession {
  user: FakeUser;
  token: string;
  expired: boolean;
}

/** What the fake Google chooser does on the next sign-in; an e-mail picks that fake account. */
export type GoogleNext = 'admin' | 'outsider' | 'cancel' | `${string}@${string}`;

export interface Injection {
  op: FakeOp | '*';
  error: Error | 'network';
  times: number;
}

export interface State {
  limits: Limits;
  users: FakeUser[];
  session: FakeSession | null;
  categories: Map<string, CategoryRow>;
  albums: Map<string, AlbumRow>;
  photos: Map<string, PhotoRow>;
  /** photo_id -> bytes and expiry of an upload reservation. */
  reservations: Map<string, { bytes: number; expiresAtMs: number }>;
  /** Bucket content: key -> size and write time. Only sizes are kept. */
  objects: Map<string, FakeObject>;
  grants: Map<string, FakeGrant>;
  site: SiteStateRow;
  /** The single site_settings row (home hero photo). */
  settings: SiteSettingsRow;
  publishLog: PublishLogRow[];
  /** Unpublished changes (the change_log table); see changes.ts. */
  changeLog: ChangeLogRow[];
  changeSeq: number;
  /** What `/_publish.json` currently shows. */
  published: PublishStatus | null;
  /** A build that has been triggered and becomes visible at atMs. */
  pendingBuild: { status: PublishStatus; atMs: number } | null;
  offline: boolean;
  slowPutMs: number | null;
  /** null = a triggered build never shows up (tests the publish timeout). */
  buildDelayMs: number | null;
  enforceContentLength: boolean;
  reconcilePageObjects: number;
  failures: Injection[];
  tokenCounter: number;
  /** Fake Google chooser: `next` is consumed by the next signInWithGoogle (null = admin). */
  google: { next: GoogleNext | null; callbackError: CallbackError | null };
}

export interface Core {
  clock: Clock;
  ids: Ids;
  state: State;
  iso(): string;
  /** A new updated_at: the current time, but always later than `prev`, so optimistic concurrency can see every write. */
  stamp(prev?: string): string;
  /** The database bumps site_state.pending_changes once per changed row. */
  bump(rows?: number): void;
  /** Runs before every port call: offline, session, then injected failures. */
  guard(op: FakeOp, options?: { auth?: boolean }): void;
  /** Auth-change subscribers (one function per AuthPort.onAuthChange call). */
  listeners: Set<() => void>;
}

export function createCore(clock: Clock, ids: Ids, state: State): Core {
  const core: Core = {
    clock,
    ids,
    state,
    listeners: new Set(),
    iso: () => new Date(clock.now()).toISOString(),
    stamp(prev) {
      let ms = clock.now();
      if (prev !== undefined && ms <= Date.parse(prev)) ms = Date.parse(prev) + 1;
      return new Date(ms).toISOString();
    },
    bump(rows = 1) {
      state.site.pending_changes += rows;
    },
    guard(op, options = {}) {
      if (state.offline) throw new NetworkError();
      if (options.auth) {
        const s = state.session;
        if (!s || s.expired) throw new ApiError('UNAUTHENTICATED');
        if (!s.user.isAdmin) throw new ApiError('NOT_ADMIN');
      }
      const i = state.failures.findIndex((f) => f.op === op || f.op === '*');
      if (i >= 0) {
        const f = state.failures[i]!;
        f.times -= 1;
        if (f.times <= 0) state.failures.splice(i, 1);
        throw f.error === 'network' ? new NetworkError() : f.error;
      }
    },
  };
  return core;
}

/** Deep copy so callers can never mutate the world through a returned row. */
export const copy = <T>(value: T): T => structuredClone(value);

export const bySortThenId = (a: { sort: number; id: string }, b: { sort: number; id: string }) =>
  a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
