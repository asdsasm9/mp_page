/**
 * POST /uploads/commit (WP-4 section 4.7). The Worker verifies every object with HEAD (exists, declared
 * size, per-file limit, within the reservation) before the database `register_photo` runs, because a
 * presigned PUT may not enforce content length. Objects of a refused commit are removed, but only when
 * no photo row owns them. D-7: a direct register_photo call can skip the HEAD check, never the quota.
 */
import {
  CommitRequestSchema,
  allKeys,
  apiCodeFromZodError,
  sumBytes,
  type CommitRequest,
  type StorageAdapter,
} from '@mp/shared';
import type { Route } from '../index';
import { errorResponse, jsonResponse, readJsonBody } from '../http';
import { removePhotoObjects } from './remove-photo-objects';

type Variants = CommitRequest['variants'];

/** Declared byte size of each key, in the order of `allKeys`. */
function declaredBytes(v: Variants): number[] {
  return [v.master.bytes, ...v.webp.map((e) => e.bytes), v.jpeg.bytes, v.og.bytes];
}

/** Delete every object under the photo prefix. Failures are swallowed: reconcile finds leftovers. */
async function removeObjects(storage: StorageAdapter, photoId: string): Promise<void> {
  try {
    await removePhotoObjects(storage, photoId);
  } catch {
    /* leftover objects are reported by reconcile */
  }
}

export function createCommitRoute(deps: { storage: StorageAdapter }): Route {
  const { storage } = deps;
  return {
    methods: ['POST'],
    handler: async ({ request, supabase, jwt }) => {
      const body = await readJsonBody(request);
      if (!body.ok) return errorResponse(body.code);
      const parsed = CommitRequestSchema.safeParse(body.value);
      if (!parsed.success) return errorResponse(apiCodeFromZodError(parsed.error));
      const req = parsed.data;

      const cfgRes = await supabase.select<{ max_upload_bytes: number }>(
        'app_config',
        { select: 'max_upload_bytes' },
        jwt,
      );
      if (!cfgRes.ok) return errorResponse(cfgRes.code);
      if (!cfgRes.data[0]) return errorResponse('UPSTREAM_ERROR');
      const maxUpload = Number(cfgRes.data[0].max_upload_bytes);

      /** Remove the objects unless a photo row with this id exists (then they belong to it). */
      const cleanup = async (): Promise<void> => {
        const row = await supabase.select('photos', { select: 'id', id: `eq.${req.photo_id}` }, jwt);
        if (row.ok && row.data.length === 0) await removeObjects(storage, req.photo_id);
      };
      const mismatch = async (): Promise<Response> => {
        await cleanup();
        return errorResponse('KEY_MISMATCH');
      };

      // Verification before the database is touched.
      const keys = allKeys(req.photo_id, req.variants);
      const declared = declaredBytes(req.variants);
      let actualSum = 0;
      try {
        const heads = await Promise.all(keys.map((k) => storage.head(k)));
        for (const [i, info] of heads.entries()) {
          if (!info || info.bytes !== declared[i] || info.bytes > maxUpload) return await mismatch();
          actualSum += info.bytes;
        }
      } catch {
        return errorResponse('UPSTREAM_ERROR');
      }
      if (actualSum !== req.bytes_total || sumBytes(req.variants) !== req.bytes_total) return mismatch();

      const reservation = await supabase.select<{ bytes: number }>(
        'upload_reservations',
        { select: 'bytes', photo_id: `eq.${req.photo_id}` },
        jwt,
      );
      if (!reservation.ok) return errorResponse(reservation.code);
      const reserved = reservation.data[0];
      if (reserved && actualSum > Number(reserved.bytes)) return mismatch();

      const rpc = await supabase.rpc<Record<string, unknown>>(
        'register_photo',
        {
          p_id: req.photo_id,
          p_album_id: req.album_id,
          p_width: req.width,
          p_height: req.height,
          p_variants: req.variants,
          p_bytes_total: req.bytes_total,
          p_dominant_color: req.dominant_color ?? null,
          p_alt: req.alt ?? null,
          p_legacy_key: req.legacy_key ?? null,
        },
        jwt,
      );
      if (!rpc.ok) {
        if (rpc.code === 'STORAGE_FULL' || rpc.code === 'BYTES_MISMATCH' || rpc.code === 'ALBUM_NOT_FOUND') {
          await cleanup();
        }
        return errorResponse(rpc.code);
      }
      const { already_existed, ...photo } = rpc.data;
      return jsonResponse({ photo, already_existed: already_existed === true }, 200);
    },
  };
}
