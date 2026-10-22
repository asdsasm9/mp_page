/**
 * The fake world: an in-memory Supabase + Worker + R2 + public site that enforces the same rules as the
 * real ones (quota and level from config, batch and per-file limits, first-fit reserve, idempotent
 * commit, delete lowers usage, pending_changes, one publish per 60 s on the injected Clock).
 *
 * Failure injection for tests and the browser checks: failNext, dropNetwork, expireSession, slowPut.
 */
import { DEFAULT_LIMITS, type ChangeLogRow, type Limits, type Snapshot } from '@mp/shared';
import { sortedChangeLog } from './changes';
import type { Clock, Ids, Ports } from '../../ports';
import { createFakeApi } from './api';
import { FAKE_ADMIN, FAKE_OUTSIDER, createFakeAuth, notifyAuthChange } from './auth';
import { createFakeCatalog } from './catalog';
import { createManualClock, createSeqIds } from './clock';
import { createCore, type FakeOp, type FakeUser, type GoogleNext, type State } from './core';
import { seedFromSnapshot } from './seed';
import { createFakePublishStatus, createFakeUpload } from './storage';

export interface FakeWorldOptions {
  /** Default: a manual clock starting 2026-10-20 08:00 UTC, which only moves when the test advances it. */
  clock?: Clock;
  ids?: Ids;
  /** Catalog to start with; default is an empty catalog. */
  seed?: Snapshot;
  limits?: Partial<Limits>;
  users?: FakeUser[];
  /** Start with the administrator signed in. */
  signedIn?: boolean;
  /** Milliseconds from /publish until `/_publish.json` shows the new snapshot; null = never. Default 90 s. */
  buildDelayMs?: number | null;
  /** R2 may not enforce the signed content-length (docs/VERIFY.md row 4). Default true. */
  enforceContentLength?: boolean;
  /** Objects per reconcile call before a cursor is returned. Default 20000 (20 pages of 1000). */
  reconcilePageObjects?: number;
}

export interface WorldSnapshot {
  now: string;
  limits: Limits;
  signedInAs: string | null;
  sessionExpired: boolean;
  offline: boolean;
  categories: unknown[];
  albums: unknown[];
  photos: unknown[];
  reservations: { photo_id: string; bytes: number; expires_at: string }[];
  objects: { key: string; bytes: number }[];
  site: { pending_changes: number; last_published_at: string | null; last_publish_requested_at: string | null };
  publishLog: unknown[];
  changeLog: ChangeLogRow[];
  published: unknown;
  queuedFailures: number;
}

export interface FakeWorld {
  ports: Ports;
  clock: Clock;
  /** The next `times` calls of `op` (or of any port with '*') throw `error` ('network' = NetworkError). */
  failNext(op: FakeOp | '*', error: Error | 'network', times?: number): void;
  /** While on, every port call throws NetworkError. */
  dropNetwork(on?: boolean): void;
  /** The session stops working: calls answer 401 until the next sign-in. */
  expireSession(): void;
  /** Each PUT takes `ms` on the clock (and can be aborted meanwhile); null = instant. */
  slowPut(ms: number | null): void;
  /** The fake Google chooser: `google.next` is consumed by the next signInWithGoogle (default 'admin'). */
  google: { next: GoogleNext | null };
  /** Changes the configuration the way editing app_config would. */
  setLimits(limits: Partial<Limits>): void;
  setBuildDelay(ms: number | null): void;
  /** Puts an object straight into the bucket (for orphans), `ageMs` old. */
  putObject(key: string, bytes: number, ageMs?: number): void;
  /** Removes an object straight from the bucket (for "missing" reports). */
  removeObject(key: string): void;
  /** A plain-data copy of everything, for assertions. Never contains tokens. */
  snapshot(): WorldSnapshot;
}

export function createFakeWorld(options: FakeWorldOptions = {}): FakeWorld {
  const clock = options.clock ?? createManualClock();
  const ids = options.ids ?? createSeqIds();
  const state: State = {
    limits: { ...DEFAULT_LIMITS, ...options.limits },
    users: options.users ?? [{ ...FAKE_ADMIN }, { ...FAKE_OUTSIDER }],
    session: null,
    categories: new Map(),
    albums: new Map(),
    photos: new Map(),
    reservations: new Map(),
    objects: new Map(),
    grants: new Map(),
    site: { id: true, pending_changes: 0, last_published_at: null, last_publish_requested_at: null },
    publishLog: [],
    changeLog: [],
    changeSeq: 0,
    published: null,
    pendingBuild: null,
    offline: false,
    slowPutMs: null,
    buildDelayMs: options.buildDelayMs === undefined ? 90_000 : options.buildDelayMs,
    enforceContentLength: options.enforceContentLength ?? true,
    reconcilePageObjects: options.reconcilePageObjects ?? 20_000,
    failures: [],
    tokenCounter: 0,
    google: { next: null, callbackError: null },
  };
  const core = createCore(clock, ids, state);
  if (options.seed) seedFromSnapshot(core, options.seed);
  if (options.signedIn) {
    const admin = state.users.find((u) => u.isAdmin);
    if (admin) state.session = { user: admin, token: `fake-token-${++state.tokenCounter}`, expired: false };
  }

  const ports: Ports = {
    auth: createFakeAuth(core),
    catalog: createFakeCatalog(core),
    api: createFakeApi(core),
    upload: createFakeUpload(core),
    publishStatus: createFakePublishStatus(core),
    clock,
    ids,
  };

  return {
    ports,
    clock,
    google: state.google,
    failNext(op, error, times = 1) {
      state.failures.push({ op, error, times });
    },
    dropNetwork(on = true) {
      state.offline = on;
    },
    expireSession() {
      if (state.session) state.session.expired = true;
      notifyAuthChange(core);
    },
    slowPut(ms) {
      state.slowPutMs = ms;
    },
    setLimits(limits) {
      state.limits = { ...state.limits, ...limits };
    },
    setBuildDelay(ms) {
      state.buildDelayMs = ms;
    },
    putObject(key, bytes, ageMs = 0) {
      state.objects.set(key, { bytes, uploadedAtMs: clock.now() - ageMs });
    },
    removeObject(key) {
      state.objects.delete(key);
    },
    snapshot() {
      const sortBy = <T extends { sort: number; id: string }>(rows: Iterable<T>) =>
        structuredClone([...rows].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1)));
      return {
        now: core.iso(),
        limits: { ...state.limits },
        signedInAs: state.session && !state.session.expired ? state.session.user.email : null,
        sessionExpired: state.session?.expired ?? false,
        offline: state.offline,
        categories: sortBy(state.categories.values()),
        albums: sortBy(state.albums.values()),
        photos: sortBy(state.photos.values()),
        reservations: [...state.reservations.entries()]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([photo_id, r]) => ({ photo_id, bytes: r.bytes, expires_at: new Date(r.expiresAtMs).toISOString() })),
        objects: [...state.objects.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, o]) => ({ key, bytes: o.bytes })),
        site: { ...state.site },
        publishLog: structuredClone(state.publishLog),
        changeLog: sortedChangeLog(state.changeLog).map((l) => ({ ...l })),
        published: structuredClone(state.published),
        queuedFailures: state.failures.reduce((n, f) => n + f.times, 0),
      };
    },
  };
}
