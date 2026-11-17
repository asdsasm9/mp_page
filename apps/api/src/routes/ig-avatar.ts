/**
 * POST /ig/avatar/reserve and POST /ig/avatar/cleanup (WP-16). The Instagram preview avatar is one
 * small WebP at `ig/avatar/<uuid>.webp`, outside the photo pipeline and the photo quota. The Worker
 * picks the key (the client never does); the profile save writes `ig_profile.avatar_key`. Cleanup
 * removes superseded or oversized objects. Presigned URLs are never logged (nothing is logged here).
 */
import {
  IG_AVATAR_MAX_BYTES,
  IG_AVATAR_MAX_LIVE,
  IgAvatarCleanupRequestSchema,
  IgAvatarReserveRequestSchema,
  ORPHAN_MIN_AGE_MS,
  PHOTO_CACHE_CONTROL,
  PRESIGN_EXPIRY_SEC,
  apiCodeFromZodError,
  igAvatarKey,
  igAvatarPrefix,
  type StorageAdapter,
  type StorageObjectInfo,
  type UploadTarget,
  type WorkerErrorCode,
} from '@mp/shared';
import type { Route } from '../index';
import type { SupabaseClient } from '../supabase';
import { errorResponse, jsonResponse, readJsonBody } from '../http';

export interface IgAvatarDeps {
  storage: StorageAdapter;
  /** Clock (default: real time). */
  now?: () => Date;
  /** Uuid source (default: crypto.randomUUID). */
  uuid?: () => string;
}

async function listAll(storage: StorageAdapter, prefix: string): Promise<StorageObjectInfo[]> {
  const out: StorageObjectInfo[] = [];
  let cursor: string | undefined;
  do {
    const page = await storage.list(prefix, cursor === undefined ? {} : { cursor });
    out.push(...page.objects);
    cursor = page.cursor;
  } while (cursor !== undefined);
  return out;
}

type Current = { ok: true; key: string | null } | { ok: false; code: WorkerErrorCode };

/** The saved avatar key, read with the caller's JWT. A missing row is an upstream fault (never delete blind). */
async function currentAvatarKey(supabase: SupabaseClient, jwt: string): Promise<Current> {
  const res = await supabase.select<{ avatar_key: string | null }>('ig_profile', { select: 'avatar_key' }, jwt);
  if (!res.ok) return { ok: false, code: res.code };
  const row = res.data[0];
  if (!row) return { ok: false, code: 'UPSTREAM_ERROR' };
  return { ok: true, key: row.avatar_key };
}

/** Deletes every non-current object that is old enough, plus any non-current oversized one. */
async function runCleanup(storage: StorageAdapter, current: string | null, nowMs: number): Promise<number> {
  const objects = await listAll(storage, igAvatarPrefix);
  const cutoff = nowMs - ORPHAN_MIN_AGE_MS;
  const doomed = objects
    .filter((o) => o.key !== current)
    .filter((o) => o.bytes > IG_AVATAR_MAX_BYTES || (o.uploaded !== undefined && Date.parse(o.uploaded) <= cutoff))
    .map((o) => o.key);
  if (doomed.length > 0) await storage.delete(doomed);
  return doomed.length;
}

export function createIgAvatarReserveRoute(deps: IgAvatarDeps): Route {
  const { storage } = deps;
  const now = deps.now ?? (() => new Date());
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  return {
    methods: ['POST'],
    handler: async ({ request, supabase, jwt }) => {
      const body = await readJsonBody(request);
      if (!body.ok) return errorResponse(body.code);
      const parsed = IgAvatarReserveRequestSchema.safeParse(body.value);
      if (!parsed.success) return errorResponse(apiCodeFromZodError(parsed.error));
      const { bytes } = parsed.data;
      if (bytes > IG_AVATAR_MAX_BYTES) return errorResponse('FILE_TOO_LARGE');

      try {
        let live = (await listAll(storage, igAvatarPrefix)).length;
        if (live >= IG_AVATAR_MAX_LIVE) {
          const current = await currentAvatarKey(supabase, jwt);
          if (!current.ok) return errorResponse(current.code);
          await runCleanup(storage, current.key, now().getTime());
          live = (await listAll(storage, igAvatarPrefix)).length;
          if (live >= IG_AVATAR_MAX_LIVE) return errorResponse('STORAGE_FULL');
        }

        const key = igAvatarKey(uuid());
        const signed = await storage.presignPut(key, {
          contentType: 'image/webp',
          contentLength: bytes,
          expiresInSec: PRESIGN_EXPIRY_SEC,
          cacheControl: PHOTO_CACHE_CONTROL,
        });
        const upload: UploadTarget = {
          kind: 'webp',
          key,
          method: signed.method,
          url: signed.url,
          headers: signed.headers,
          expiresAt: signed.expiresAt,
        };
        return jsonResponse({ key, upload }, 200);
      } catch {
        return errorResponse('UPSTREAM_ERROR');
      }
    },
  };
}

export function createIgAvatarCleanupRoute(deps: IgAvatarDeps): Route {
  const { storage } = deps;
  const now = deps.now ?? (() => new Date());
  return {
    methods: ['POST'],
    handler: async ({ request, supabase, jwt }) => {
      const body = await readJsonBody(request, { allowEmpty: true });
      if (!body.ok) return errorResponse(body.code);
      const parsed = IgAvatarCleanupRequestSchema.safeParse(body.value);
      if (!parsed.success) return errorResponse(apiCodeFromZodError(parsed.error));

      const current = await currentAvatarKey(supabase, jwt);
      if (!current.ok) return errorResponse(current.code);
      try {
        const deleted = await runCleanup(storage, current.key, now().getTime());
        return jsonResponse({ deleted }, 200);
      } catch {
        return errorResponse('UPSTREAM_ERROR');
      }
    },
  };
}
