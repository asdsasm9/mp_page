/**
 * Fake Worker (docs/API.md, apps/api/src/routes). Same order of checks as the real routes, the same
 * SQL rules (supabase/migrations E1 to E3), requests parsed and responses validated with the shared
 * zod schemas, so a drift between this file and the contract fails loudly.
 */
import {
  CommitRequestSchema,
  CommitResponseSchema,
  DeleteRequestSchema,
  DeleteResponseSchema,
  ORPHAN_MIN_AGE_MS,
  PUBLISH_MIN_GAP_MS,
  PHOTO_CACHE_CONTROL,
  CONTENT_TYPE_BY_KIND,
  PublishResponseSchema,
  ReconcileRequestSchema,
  ReconcileResponseSchema,
  ReserveRequestSchema,
  ReserveResponseSchema,
  StorageResponseSchema,
  allKeys,
  apiCodeFromZodError,
  assertPublishable,
  buildSnapshot,
  evaluateQuota,
  masterKey,
  parseKey,
  photoPrefix,
  planUploadFiles,
  PRESIGN_EXPIRY_SEC,
  checkCommitBytes,
  commitQuotaOk,
  hasOversizedFile,
  itemBytes,
  reservationActive,
  totalBytes,
  variantBytes,
  type PhotoRow,
  type PublishLogRow,
  type UploadTarget,
} from '@mp/shared';
import { ApiError, NetworkError, type ApiPort } from '../../ports';
import { clearCoversOfPhoto } from './catalog';
import { copy, type Core } from './core';

const PRESIGN_EXPIRY_MS = PRESIGN_EXPIRY_SEC * 1000;
const PUBLISH_LOG_KEEP = 100;

type ZodErrorLike = Parameters<typeof apiCodeFromZodError>[0];
interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: ZodErrorLike };
}

function parseRequest<T>(schema: Schema<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new ApiError(apiCodeFromZodError(r.error));
  return r.data;
}

/** A response that does not match the shared schema is a bug in the fake, not a runtime error. */
function respond<T>(schema: Schema<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new Error(`FAKE_WORLD_CONTRACT_VIOLATION: ${JSON.stringify(r.error)}`);
  return r.data;
}

export function createFakeApi(core: Core): ApiPort {
  const { state, clock } = core;
  const guard = (op: Parameters<Core['guard']>[0]) => core.guard(op, { auth: true });
  const encoder = new TextEncoder();

  const liveReservations = () => [...state.reservations.entries()].filter(([, r]) => reservationActive(r, clock.now()));
  const usedBytes = () => totalBytes(state.photos.values());
  function usage() {
    const used = usedBytes();
    let reserved = 0;
    for (const [, r] of liveReservations()) reserved += r.bytes;
    const hard = state.limits.quotaHardBytes;
    const warn = state.limits.quotaWarnBytes;
    return { used, reserved, hard, warn, level: evaluateQuota({ used, reserved, hard, warn }).level };
  }

  function removeObjectsOf(photoId: string): number {
    const prefix = photoPrefix(photoId);
    let n = 0;
    for (const key of [...state.objects.keys()]) {
      if (key.startsWith(prefix)) {
        state.objects.delete(key);
        n++;
      }
    }
    return n;
  }

  function presign(photoId: string, width: number, height: number, bytesOf: (kind: string, tier?: number) => number) {
    const uploads: UploadTarget[] = [];
    for (const planned of planUploadFiles(photoId, width, height)) {
      const bytes = bytesOf(planned.kind, planned.tier);
      const expiresAtMs = clock.now() + PRESIGN_EXPIRY_MS;
      const url = `https://fake-r2.invalid/${planned.key}?sig=${state.grants.size + 1}`;
      const headers = {
        'content-type': CONTENT_TYPE_BY_KIND[planned.kind],
        'content-length': String(bytes),
        'cache-control': PHOTO_CACHE_CONTROL,
      };
      state.grants.set(url, { key: planned.key, headers, contentLength: bytes, expiresAtMs });
      const target: UploadTarget = {
        kind: planned.kind,
        key: planned.key,
        method: 'PUT',
        url,
        headers,
        expiresAt: new Date(expiresAtMs).toISOString(),
      };
      if (planned.tier !== undefined) target.tier = planned.tier;
      uploads.push(target);
    }
    return uploads;
  }

  /** request_publish: rate limit, log row, timestamp. */
  function requestPublish(): { log: PublishLogRow; pendingSeen: number } {
    const now = clock.now();
    const last = state.site.last_publish_requested_at;
    if (last !== null && Date.parse(last) > now - PUBLISH_MIN_GAP_MS) {
      const retryAfter = Math.ceil((Date.parse(last) + PUBLISH_MIN_GAP_MS - now) / 1000);
      throw new ApiError('PUBLISH_TOO_SOON', { retryAfter });
    }
    const log: PublishLogRow = {
      id: core.ids.uuid(),
      requested_by: state.session?.user.id ?? null,
      requested_at: core.iso(),
      finished_at: null,
      status: 'started',
      pending_seen: state.site.pending_changes,
      album_count: null,
      photo_count: null,
      snapshot_bytes: null,
      error: null,
    };
    state.publishLog.push(log);
    state.site.last_publish_requested_at = log.requested_at;
    if (state.publishLog.length > PUBLISH_LOG_KEEP) state.publishLog.splice(0, state.publishLog.length - PUBLISH_LOG_KEEP);
    return { log, pendingSeen: state.site.pending_changes };
  }

  function failLog(log: PublishLogRow, error: string): void {
    log.status = 'failed';
    log.finished_at = core.iso();
    log.error = error;
  }

  return {
    async getStorage() {
      guard('api.getStorage');
      const u = usage();
      return respond(StorageResponseSchema, {
        used_bytes: u.used,
        reserved_bytes: u.reserved,
        hard: u.hard,
        warn: u.warn,
        photo_count: state.photos.size,
        level: u.level,
      });
    },

    async reserve(request) {
      guard('api.reserve');
      const { album_id, items } = parseRequest(ReserveRequestSchema, request);
      if (items.length > state.limits.maxFilesPerBatch) throw new ApiError('BATCH_TOO_LARGE');
      if (!state.albums.has(album_id)) throw new ApiError('ALBUM_NOT_FOUND');
      if (items.some((i) => state.photos.has(i.photo_id))) throw new ApiError('CONFLICT');

      // Per-file limit first; those items never reach reserve_uploads.
      const maxUpload = state.limits.maxUploadBytes;
      const tooLarge = new Set(items.filter((i) => hasOversizedFile(i.files, maxUpload)).map((i) => i.photo_id));

      // reserve_uploads: expired rows go, then first-fit in order; refused items consume nothing.
      for (const [id, r] of state.reservations) if (!reservationActive(r, clock.now())) state.reservations.delete(id);
      const used = usedBytes();
      let reserved = 0;
      for (const r of state.reservations.values()) reserved += r.bytes;
      const { quotaHardBytes: hard, quotaWarnBytes: warn } = state.limits;

      const out: { photo_id: string; ok: boolean; code?: 'FILE_TOO_LARGE' | 'STORAGE_FULL'; uploads?: UploadTarget[] }[] = [];
      for (const item of items) {
        if (tooLarge.has(item.photo_id)) {
          out.push({ photo_id: item.photo_id, ok: false, code: 'FILE_TOO_LARGE' });
          continue;
        }
        const bytes = itemBytes(item.files);
        const old = state.reservations.get(item.photo_id);
        if (old) {
          reserved -= old.bytes;
          state.reservations.delete(item.photo_id);
        }
        if (bytes > maxUpload) {
          out.push({ photo_id: item.photo_id, ok: false, code: 'FILE_TOO_LARGE' });
        } else if (!commitQuotaOk(used, reserved, bytes, hard)) {
          out.push({ photo_id: item.photo_id, ok: false, code: 'STORAGE_FULL' });
        } else {
          state.reservations.set(item.photo_id, {
            bytes,
            expiresAtMs: clock.now() + state.limits.reservationTtlMin * 60_000,
          });
          reserved += bytes;
          const uploads = presign(item.photo_id, item.width, item.height, (kind, tier) =>
            item.files.find((f) => f.kind === kind && f.tier === tier)!.bytes,
          );
          out.push({ photo_id: item.photo_id, ok: true, uploads });
        }
      }
      return respond(ReserveResponseSchema, {
        items: out,
        used_bytes: used,
        reserved_bytes: reserved,
        hard,
        warn,
        level: evaluateQuota({ used, reserved, hard, warn }).level,
      });
    },

    async commit(request, options) {
      guard('api.commit');
      if (options?.signal?.aborted) throw new NetworkError();
      const req = parseRequest(CommitRequestSchema, request);
      const cleanup = () => {
        if (!state.photos.has(req.photo_id)) removeObjectsOf(req.photo_id);
      };
      const mismatch = (): never => {
        cleanup();
        throw new ApiError('KEY_MISMATCH');
      };

      // Verification before the database is touched (HEAD on every object).
      const keys = allKeys(req.photo_id, req.variants);
      const v = req.variants;
      const actual = keys.map((key) => state.objects.get(key)?.bytes ?? null);
      const verify = { variants: v, bytesTotal: req.bytes_total, actual, maxUploadBytes: state.limits.maxUploadBytes };
      if (!checkCommitBytes(verify)) mismatch();
      // An expired row still binds until reserve_uploads purges it (as in the Worker).
      const reservation = state.reservations.get(req.photo_id);
      if (reservation && !checkCommitBytes({ ...verify, reservedBytes: reservation.bytes })) mismatch();

      // register_photo (its BYTES_MISMATCH check is unreachable here: the sum was verified above)
      const existing = state.photos.get(req.photo_id);
      if (existing) {
        if (existing.album_id === req.album_id && existing.bytes_total === req.bytes_total) {
          return respond(CommitResponseSchema, { photo: copy(existing), already_existed: true });
        }
        throw new ApiError('CONFLICT');
      }
      if (req.legacy_key !== undefined) {
        const byLegacy = [...state.photos.values()].find((p) => p.legacy_key === req.legacy_key);
        if (byLegacy) return respond(CommitResponseSchema, { photo: copy(byLegacy), already_existed: true });
      }
      if (!state.albums.has(req.album_id)) {
        cleanup();
        throw new ApiError('ALBUM_NOT_FOUND');
      }
      let othersReserved = 0;
      for (const [id, r] of liveReservations()) if (id !== req.photo_id) othersReserved += r.bytes;
      if (!commitQuotaOk(usedBytes(), othersReserved, req.bytes_total, state.limits.quotaHardBytes)) {
        cleanup();
        throw new ApiError('STORAGE_FULL');
      }
      state.reservations.delete(req.photo_id);
      let maxSort = 0;
      for (const p of state.photos.values()) if (p.album_id === req.album_id) maxSort = Math.max(maxSort, p.sort);
      const now = core.iso();
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
      state.photos.set(photo.id, photo);
      core.bump();
      return respond(CommitResponseSchema, { photo: copy(photo), already_existed: false });
    },

    async deletePhotos(request) {
      guard('api.deletePhotos');
      const { ids } = parseRequest(DeleteRequestSchema, request);
      let deleted = 0;
      let objectsDeleted = 0;
      for (const id of new Set(ids)) {
        if (!state.photos.has(id)) continue;
        clearCoversOfPhoto(core, id);
        state.photos.delete(id);
        core.bump();
        deleted++;
        objectsDeleted += removeObjectsOf(id);
      }
      return respond(DeleteResponseSchema, { deleted, objectsDeleted, failed: [], publishRecommended: true });
    },

    async reconcile(request) {
      guard('api.reconcile');
      const req = parseRequest(ReconcileRequestSchema, request);
      const now = clock.now();

      // Objects under photos/ grouped by photo id, in key order. A page is whole groups.
      const groups = new Map<string, string[]>();
      const unknownKeys: string[] = [];
      for (const key of [...state.objects.keys()].sort()) {
        if (!key.startsWith('photos/')) continue;
        const parsed = parseKey(key);
        if (!parsed) unknownKeys.push(key);
        const id = key.split('/')[1] ?? '';
        const list = groups.get(id);
        if (list) list.push(key);
        else groups.set(id, [key]);
      }
      const after = req.cursor;
      const ids = [...groups.keys()].sort().filter((id) => after === undefined || id > after);
      const pageIds: string[] = [];
      let pageObjects = 0;
      for (const id of ids) {
        if (pageObjects >= state.reconcilePageObjects) break;
        pageIds.push(id);
        pageObjects += groups.get(id)!.length;
      }
      const hasMore = pageIds.length < ids.length;
      const lastId = pageIds[pageIds.length - 1];

      const inRange = (id: string) => (after === undefined || id > after) && (!hasMore || (lastId !== undefined && id <= lastId));
      const rows = [...state.photos.values()].filter((p) => inRange(p.id)).sort((a, b) => (a.id < b.id ? -1 : 1));

      let r2Bytes = 0;
      const orphans: { id: string; objects: number; bytes: number }[] = [];
      const doomed: string[] = [];
      for (const id of pageIds) {
        const keys = groups.get(id)!;
        const bytes = keys.reduce((n, k) => n + state.objects.get(k)!.bytes, 0);
        r2Bytes += bytes;
        const parsedId = parseKey(keys[0]!)?.id;
        if (state.photos.has(id) || parsedId === undefined) continue;
        if (state.reservations.has(id)) continue;
        if (!keys.every((k) => now - state.objects.get(k)!.uploadedAtMs > ORPHAN_MIN_AGE_MS)) continue;
        orphans.push({ id, objects: keys.length, bytes });
        doomed.push(...keys);
      }

      const missing: { id: string; keys: string[] }[] = [];
      const sizeMismatch: { id: string; key: string; expected: number; actual: number }[] = [];
      for (const row of rows) {
        const keys = allKeys(row.id, row.variants);
        const expected = variantBytes(row.variants);
        const gone: string[] = [];
        for (const [i, key] of keys.entries()) {
          const obj = state.objects.get(key);
          if (!obj) gone.push(key);
          else if (obj.bytes !== expected[i]) sizeMismatch.push({ id: row.id, key, expected: expected[i]!, actual: obj.bytes });
        }
        if (gone.length > 0) missing.push({ id: row.id, keys: gone });
      }

      const apply = req.apply === true;
      if (apply) for (const key of doomed) state.objects.delete(key);
      const pageUnknown = unknownKeys.filter((k) => pageIds.includes(k.split('/')[1] ?? ''));
      return respond(ReconcileResponseSchema, {
        r2: { objects: pageObjects, bytes: r2Bytes },
        db: { photos: rows.length, bytes: rows.reduce((n, p) => n + p.bytes_total, 0) },
        orphans,
        missing,
        sizeMismatch,
        unknownKeys: pageUnknown,
        applied: apply,
        deleted: apply ? doomed.length : 0,
        ...(hasMore && lastId !== undefined ? { cursor: lastId } : {}),
      });
    },

    async publish() {
      try {
        guard('api.publish');
      } catch (e) {
        // The Worker's publish step failing happens after request_publish: the rate limit is already spent.
        if (e instanceof ApiError && e.code === 'PUBLISH_FAILED') {
          const { log } = requestPublish();
          failLog(log, 'PUBLISH_FAILED');
        }
        throw e;
      }
      const { log, pendingSeen } = requestPublish();
      const now = clock.now();
      const snapshot = buildSnapshot(
        {
          categories: [...state.categories.values()],
          albums: [...state.albums.values()],
          photos: [...state.photos.values()],
          // Fake world keeps no slug history; the real Worker passes the real url_history rows (see docs/ADMIN.md).
          urlHistory: [],
        },
        new Date(now),
      );
      try {
        assertPublishable(snapshot);
      } catch {
        failLog(log, 'SNAPSHOT_EMPTY');
        throw new ApiError('SNAPSHOT_EMPTY');
      }
      const snapshotBytes = encoder.encode(JSON.stringify(snapshot)).length;
      log.status = 'ok';
      log.finished_at = core.iso();
      log.album_count = snapshot.counts.albums;
      log.photo_count = snapshot.counts.photos;
      log.snapshot_bytes = snapshotBytes;
      state.site.pending_changes = Math.max(state.site.pending_changes - pendingSeen, 0);
      state.site.last_published_at = log.finished_at;

      state.pendingBuild =
        state.buildDelayMs === null
          ? null
          : {
              atMs: now + state.buildDelayMs,
              status: {
                snapshotGeneratedAt: snapshot.generatedAt,
                builtAt: new Date(now + state.buildDelayMs).toISOString(),
                counts: snapshot.counts,
              },
            };
      return respond(PublishResponseSchema, {
        log_id: log.id,
        snapshot_generated_at: snapshot.generatedAt,
        counts: snapshot.counts,
        snapshot_bytes: snapshotBytes,
        pending_seen: pendingSeen,
      });
    },
  };
}
