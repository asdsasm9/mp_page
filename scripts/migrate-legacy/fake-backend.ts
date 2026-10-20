// FakeBackend: the in-memory MigrationBackend for offline tests (plan WP-06 section 3.1).
//
// Decision on reuse (T-149): the admin fake world (apps/admin/src/adapters/fake/world.ts) was NOT
// reused. It is built on the admin app's browser Ports (Clock, Ids, Auth, Catalog, Upload) and on a
// State that keeps objects as sizes only, so a script would have to import app internals and fake
// the browser upload port to get at it. apps/api/test/supabase-shim.ts is a PostgREST/RPC shim for
// the Worker, which is the wrong layer: the migration talks to the Worker, not to Postgres. Instead
// this file reuses the shared pieces both fakes are made of: the zod request/response schemas
// (api.ts), planBatch/evaluateQuota (quota.ts), planUploadFiles/variantsMatchPlan, the key helpers,
// and the shared in-memory StorageAdapter fake (storage/fake.ts) for presign, PUT and HEAD. What is
// left here is only the register_photo and reserve_uploads rules, copied in the same order of
// checks as the admin fake Worker (adapters/fake/api.ts); the contract tests in
// fake-backend.test.ts keep it honest.
import {
  CommitRequestSchema,
  CommitResponseSchema,
  CONTENT_TYPE_BY_KIND,
  DEFAULT_LIMITS,
  PHOTO_CACHE_CONTROL,
  ReserveRequestSchema,
  ReserveResponseSchema,
  StorageError,
  StorageResponseSchema,
  allKeys,
  apiCodeFromZodError,
  createFakeStorage,
  evaluateQuota,
  masterKey,
  planBatch,
  planUploadFiles,
  sumBytes,
  type AlbumRow,
  type CategoryRow,
  type CommitRequest,
  type CommitResponse,
  type FakeStorage,
  type Limits,
  type PhotoRow,
  type ReserveRequest,
  type ReserveResponse,
  type StorageResponse,
  type UploadTarget,
} from '../../packages/shared/src';
import { BackendError, type AlbumInput, type CategoryInput, type MigrationBackend } from './backend';

const PRESIGN_EXPIRY_SEC = 15 * 60;
const DEFAULT_START_MS = Date.parse('2026-10-20T08:00:00.000Z');

export type FakeOp =
  | 'signIn'
  | 'listCategories'
  | 'upsertCategory'
  | 'listAlbums'
  | 'upsertAlbum'
  | 'setCover'
  | 'listPhotosByLegacyKey'
  | 'reserve'
  | 'put'
  | 'commit'
  | 'storage'
  | 'objectExists';

export interface FakeBackendOptions {
  /** Default true. False makes signIn fail with NOT_ADMIN (a signed-in outsider). */
  isAdmin?: boolean;
  limits?: Partial<Limits>;
  /** Epoch ms the manual clock starts at; it only moves through advance(). */
  startMs?: number;
  /** R2 may not enforce the signed content-length (VERIFY row 4). Default true. */
  enforceContentLength?: boolean;
  /**
   * Lets reserve presign an id that already has a row. The real Worker refuses it (CONFLICT), so live
   * --repair does not work today; this is off by default; tests switch it on to exercise the --repair logic of the script.
   */
  reserveExisting?: boolean;
}

interface Failure {
  op: FakeOp | '*';
  error: BackendError;
  times: number;
}

interface Reservation {
  bytes: number;
  expiresAtMs: number;
}

const copy = <T>(v: T): T => structuredClone(v);

export interface FakeBackend extends MigrationBackend {
  /** Every call in order, by operation name (including the ones that were made to fail). */
  readonly calls: FakeOp[];
  /** The shared in-memory bucket, for assertions and for deleting objects. */
  readonly storageFake: FakeStorage;
  /** The next `times` calls of `op` (or of any operation with '*') reject with `error` ('network' = NETWORK). */
  failNext(op: FakeOp | '*', error: BackendError | 'network' | 'server', times?: number): void;
  /** Moves the manual clock (presign and reservation expiry). */
  advance(ms: number): void;
  /** Plain copies of the stored rows. */
  photos(): PhotoRow[];
  albums(): AlbumRow[];
  categories(): CategoryRow[];
  setLimits(limits: Partial<Limits>): void;
}

export function createFakeBackend(options: FakeBackendOptions = {}): FakeBackend {
  let limits: Limits = { ...DEFAULT_LIMITS, ...options.limits };
  let offset = 0;
  const startMs = options.startMs ?? DEFAULT_START_MS;
  const nowMs = () => startMs + offset;
  const iso = () => new Date(nowMs()).toISOString();

  const storageFake = createFakeStorage({
    baseUrl: 'https://img.fake.invalid',
    now: () => new Date(nowMs()),
    enforceContentLength: options.enforceContentLength ?? true,
  });
  const categories = new Map<string, CategoryRow>();
  const albums = new Map<string, AlbumRow>();
  const photos = new Map<string, PhotoRow>();
  const reservations = new Map<string, Reservation>();
  const failures: Failure[] = [];
  const calls: FakeOp[] = [];
  let signedIn = false;

  /** Records the call, applies injected failures, and fails closed when not signed in. */
  function enter(op: FakeOp): void {
    calls.push(op);
    const f = failures.find((x) => x.times > 0 && (x.op === op || x.op === '*'));
    if (f) {
      f.times--;
      throw f.error;
    }
    if (op !== 'signIn' && !signedIn) throw new BackendError('UNAUTHENTICATED');
  }

  /** A response that does not match the shared schema is a bug in the fake, not a runtime error. */
  function respond<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: unknown } }, value: unknown): T {
    const r = schema.safeParse(value);
    if (!r.success) throw new Error(`FAKE_BACKEND_CONTRACT_VIOLATION: ${JSON.stringify(r.error)}`);
    return r.data;
  }

  function parseRequest<T>(
    schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: Parameters<typeof apiCodeFromZodError>[0] } },
    value: unknown,
  ): T {
    const r = schema.safeParse(value);
    if (!r.success) throw new BackendError(apiCodeFromZodError(r.error));
    return r.data;
  }

  const liveReserved = () => {
    for (const [id, r] of reservations) if (r.expiresAtMs <= nowMs()) reservations.delete(id);
    let n = 0;
    for (const r of reservations.values()) n += r.bytes;
    return n;
  };
  const usedBytes = () => {
    let n = 0;
    for (const p of photos.values()) n += p.bytes_total;
    return n;
  };

  return {
    calls,
    storageFake,

    failNext(op, error, times = 1) {
      const e = error === 'network' ? new BackendError('NETWORK') : error === 'server' ? new BackendError('SERVER_ERROR') : error;
      failures.push({ op, error: e, times });
    },
    advance(ms) {
      offset += ms;
    },
    photos: () => copy([...photos.values()]),
    albums: () => copy([...albums.values()]),
    categories: () => copy([...categories.values()]),
    setLimits(next) {
      limits = { ...limits, ...next };
    },

    async signIn() {
      enter('signIn');
      if (options.isAdmin === false) throw new BackendError('NOT_ADMIN');
      signedIn = true;
    },

    async listCategories() {
      enter('listCategories');
      return copy([...categories.values()]);
    },

    async upsertCategory(input: CategoryInput) {
      enter('upsertCategory');
      const existing = [...categories.values()].find((c) => c.slug === input.slug);
      if (existing) return copy(existing);
      if (categories.has(input.id)) throw new BackendError('CONFLICT');
      const now = iso();
      const row: CategoryRow = {
        id: input.id,
        slug: input.slug,
        name: input.name,
        description: null,
        seo_title: null,
        seo_description: null,
        sort: input.sort,
        visible: true,
        created_at: now,
        updated_at: now,
      };
      categories.set(row.id, row);
      return copy(row);
    },

    async listAlbums() {
      enter('listAlbums');
      return copy([...albums.values()]);
    },

    async upsertAlbum(input: AlbumInput) {
      enter('upsertAlbum');
      const existing = [...albums.values()].find((a) => a.legacy_id === input.legacy_id);
      if (existing) return copy(existing);
      if (!categories.has(input.category_id)) throw new BackendError('NOT_FOUND');
      if (albums.has(input.id) || [...albums.values()].some((a) => a.slug === input.slug)) throw new BackendError('CONFLICT');
      const now = iso();
      const row: AlbumRow = {
        id: input.id,
        category_id: input.category_id,
        slug: input.slug,
        title: input.title,
        place: input.place,
        shot_on: null,
        description: null,
        seo_title: null,
        seo_description: null,
        cover_photo_id: null,
        sort: input.sort,
        published: input.published,
        legacy_id: input.legacy_id,
        created_at: now,
        updated_at: now,
      };
      albums.set(row.id, row);
      return copy(row);
    },

    async setCover(albumId, photoId) {
      enter('setCover');
      const album = albums.get(albumId);
      if (!album) throw new BackendError('ALBUM_NOT_FOUND');
      const photo = photos.get(photoId);
      if (!photo || photo.album_id !== albumId) throw new BackendError('NOT_FOUND');
      album.cover_photo_id = photoId;
      album.updated_at = iso();
    },

    async listPhotosByLegacyKey() {
      enter('listPhotosByLegacyKey');
      return copy([...photos.values()].filter((p) => p.legacy_key !== null));
    },

    async reserve(request: ReserveRequest): Promise<ReserveResponse> {
      enter('reserve');
      const { album_id, items } = parseRequest(ReserveRequestSchema, request);
      if (items.length > limits.maxFilesPerBatch) throw new BackendError('BATCH_TOO_LARGE');
      if (!albums.has(album_id)) throw new BackendError('ALBUM_NOT_FOUND');
      if (options.reserveExisting !== true && items.some((i) => photos.has(i.photo_id))) throw new BackendError('CONFLICT');

      // A repeated reserve for the same photo replaces its old reservation (re-reserve after expiry).
      for (const i of items) reservations.delete(i.photo_id);
      const used = usedBytes();
      const reserved = liveReserved();
      const plan = planBatch(
        { used, reserved, hard: limits.quotaHardBytes, warn: limits.quotaWarnBytes, maxUploadBytes: limits.maxUploadBytes, maxFilesPerBatch: limits.maxFilesPerBatch },
        items.map((i) => ({
          photo_id: i.photo_id,
          // A single oversized file makes the whole item FILE_TOO_LARGE.
          bytes: i.files.some((f) => f.bytes > limits.maxUploadBytes) ? limits.maxUploadBytes + 1 : i.files.reduce((n, f) => n + f.bytes, 0),
        })),
      );

      const out: Array<{ photo_id: string; ok: boolean; code?: 'FILE_TOO_LARGE' | 'STORAGE_FULL'; uploads?: UploadTarget[] }> = [];
      for (const [idx, res] of plan.results.entries()) {
        const item = items[idx]!;
        if (!res.ok) {
          out.push({ photo_id: item.photo_id, ok: false, code: res.code! });
          continue;
        }
        reservations.set(item.photo_id, {
          bytes: item.files.reduce((n, f) => n + f.bytes, 0),
          expiresAtMs: nowMs() + limits.reservationTtlMin * 60_000,
        });
        const uploads: UploadTarget[] = [];
        for (const planned of planUploadFiles(item.photo_id, item.width, item.height)) {
          const bytes = item.files.find((f) => f.kind === planned.kind && f.tier === planned.tier)!.bytes;
          const signed = await storageFake.presignPut(planned.key, {
            contentType: CONTENT_TYPE_BY_KIND[planned.kind],
            contentLength: bytes,
            expiresInSec: PRESIGN_EXPIRY_SEC,
            cacheControl: PHOTO_CACHE_CONTROL,
          });
          const target: UploadTarget = {
            kind: planned.kind,
            key: planned.key,
            method: 'PUT',
            url: signed.url,
            headers: signed.headers,
            expiresAt: signed.expiresAt,
          };
          if (planned.tier !== undefined) target.tier = planned.tier;
          uploads.push(target);
        }
        out.push({ photo_id: item.photo_id, ok: true, uploads });
      }
      const reservedAfter = plan.reserved_bytes;
      return respond(ReserveResponseSchema, {
        items: out,
        used_bytes: used,
        reserved_bytes: reservedAfter,
        hard: limits.quotaHardBytes,
        warn: limits.quotaWarnBytes,
        level: evaluateQuota({ used, reserved: reservedAfter, hard: limits.quotaHardBytes, warn: limits.quotaWarnBytes }).level,
      });
    },

    async put(target, bytes) {
      enter('put');
      try {
        await storageFake.simulatePut(
          { url: target.url, method: 'PUT', headers: target.headers, expiresAt: target.expiresAt },
          bytes,
          target.headers,
        );
      } catch (e) {
        if (e instanceof StorageError) throw new BackendError(e.code === 'URL_EXPIRED' ? 'PRESIGN_EXPIRED' : 'PUT_REJECTED', e.message);
        throw e;
      }
    },

    async commit(request: CommitRequest): Promise<CommitResponse> {
      enter('commit');
      const req = parseRequest(CommitRequestSchema, request);
      const v = req.variants;
      const cleanup = async () => {
        if (!photos.has(req.photo_id)) await storageFake.delete(allKeys(req.photo_id, v));
      };
      const mismatch = async (): Promise<never> => {
        await cleanup();
        throw new BackendError('KEY_MISMATCH');
      };

      // HEAD on every object before the database is touched.
      const keys = allKeys(req.photo_id, v);
      const declared = [v.master.bytes, ...v.webp.map((e) => e.bytes), v.jpeg.bytes, v.og.bytes];
      let actualSum = 0;
      for (const [i, key] of keys.entries()) {
        const head = await storageFake.head(key);
        if (!head || head.bytes !== declared[i] || head.bytes > limits.maxUploadBytes) return mismatch();
        actualSum += head.bytes;
      }
      if (actualSum !== req.bytes_total || sumBytes(v) !== req.bytes_total) return mismatch();
      const reservation = reservations.get(req.photo_id);
      if (reservation && reservation.expiresAtMs > nowMs() && actualSum > reservation.bytes) return mismatch();

      // register_photo
      const existing = photos.get(req.photo_id);
      if (existing) {
        if (existing.album_id === req.album_id && existing.bytes_total === req.bytes_total) {
          return respond(CommitResponseSchema, { photo: copy(existing), already_existed: true });
        }
        throw new BackendError('CONFLICT');
      }
      if (req.legacy_key !== undefined) {
        const byLegacy = [...photos.values()].find((p) => p.legacy_key === req.legacy_key);
        if (byLegacy) return respond(CommitResponseSchema, { photo: copy(byLegacy), already_existed: true });
      }
      if (!albums.has(req.album_id)) {
        await cleanup();
        throw new BackendError('ALBUM_NOT_FOUND');
      }
      let othersReserved = 0;
      for (const [id, r] of reservations) if (id !== req.photo_id && r.expiresAtMs > nowMs()) othersReserved += r.bytes;
      if (usedBytes() + othersReserved + req.bytes_total > limits.quotaHardBytes) {
        await cleanup();
        throw new BackendError('STORAGE_FULL');
      }
      reservations.delete(req.photo_id);
      let maxSort = 0;
      for (const p of photos.values()) if (p.album_id === req.album_id) maxSort = Math.max(maxSort, p.sort);
      const now = iso();
      const photo: PhotoRow = {
        id: req.photo_id,
        album_id: req.album_id,
        master_key: masterKey(req.photo_id),
        width: req.width,
        height: req.height,
        variants: copy(v),
        bytes_total: req.bytes_total,
        dominant_color: req.dominant_color ?? null,
        alt: req.alt ?? null,
        caption: null,
        sort: maxSort + 10,
        legacy_key: req.legacy_key ?? null,
        created_at: now,
        updated_at: now,
      };
      photos.set(photo.id, photo);
      return respond(CommitResponseSchema, { photo: copy(photo), already_existed: false });
    },

    async storage(): Promise<StorageResponse> {
      enter('storage');
      const used = usedBytes();
      const reserved = liveReserved();
      const { quotaHardBytes: hard, quotaWarnBytes: warn } = limits;
      return respond(StorageResponseSchema, {
        used_bytes: used,
        reserved_bytes: reserved,
        hard,
        warn,
        photo_count: photos.size,
        level: evaluateQuota({ used, reserved, hard, warn }).level,
      });
    },

    async objectExists(key) {
      enter('objectExists');
      return (await storageFake.head(key)) !== null;
    },
  };
}
