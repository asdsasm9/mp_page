/**
 * POST /uploads/reserve (WP-4 section 4.7, the T-6 server-side quota guard). No upload URL is
 * issued for an item unless the database `reserve_uploads` accepted it (hard limit, per-file
 * limit, first-fit). Keys come only from the shared key helpers; the client sends kinds and bytes.
 */
import {
  ERROR_STATUS,
  PRESIGN_EXPIRY_SEC,
  hasOversizedFile,
  itemBytes,
  PHOTO_CACHE_CONTROL,
  CONTENT_TYPE_BY_KIND,
  ReserveRequestSchema,
  apiCodeFromZodError,
  planUploadFiles,
  type ReserveRequest,
  type StorageAdapter,
  type UploadTarget,
} from '@mp/shared';
import type { Route } from '../index';
import { errorResponse, jsonResponse, readJsonBody } from '../http';

interface Config {
  max_upload_bytes: number;
  max_files_per_batch: number;
}

type ItemCode = 'FILE_TOO_LARGE' | 'STORAGE_FULL';

interface RpcResult {
  results: { photo_id: string; ok: boolean; code?: string }[];
  used_bytes: number;
  reserved_bytes: number;
  hard: number;
  warn: number;
  level: 'ok' | 'warn' | 'full';
}

type ReserveItem = ReserveRequest['items'][number];

async function presignItem(storage: StorageAdapter, item: ReserveItem): Promise<UploadTarget[]> {
  const uploads: UploadTarget[] = [];
  for (const planned of planUploadFiles(item.photo_id, item.width, item.height)) {
    const declared = item.files.find((f) => f.kind === planned.kind && f.tier === planned.tier);
    // The schema guarantees the declared set equals the plan; this is a belt-and-braces check.
    if (!declared) throw new Error('plan mismatch');
    const signed = await storage.presignPut(planned.key, {
      contentType: CONTENT_TYPE_BY_KIND[planned.kind],
      contentLength: declared.bytes,
      expiresInSec: PRESIGN_EXPIRY_SEC,
      cacheControl: PHOTO_CACHE_CONTROL,
    });
    const target: UploadTarget = {
      kind: planned.kind,
      key: planned.key,
      method: signed.method,
      url: signed.url,
      headers: signed.headers,
      expiresAt: signed.expiresAt,
    };
    if (planned.tier !== undefined) target.tier = planned.tier;
    uploads.push(target);
  }
  return uploads;
}

export function createReserveRoute(deps: { storage: StorageAdapter }): Route {
  return {
    methods: ['POST'],
    handler: async ({ request, supabase, jwt }) => {
      const body = await readJsonBody(request);
      if (!body.ok) return errorResponse(body.code);
      const parsed = ReserveRequestSchema.safeParse(body.value);
      if (!parsed.success) return errorResponse(apiCodeFromZodError(parsed.error));
      const { album_id, items } = parsed.data;

      const cfgRes = await supabase.select<Config>(
        'app_config',
        { select: 'max_upload_bytes,max_files_per_batch' },
        jwt,
      );
      if (!cfgRes.ok) return errorResponse(cfgRes.code);
      const cfg = cfgRes.data[0];
      if (!cfg) return errorResponse('UPSTREAM_ERROR');
      if (items.length > Number(cfg.max_files_per_batch)) return errorResponse('BATCH_TOO_LARGE');

      const album = await supabase.select('albums', { select: 'id', id: `eq.${album_id}` }, jwt);
      if (!album.ok) return errorResponse(album.code);
      if (album.data.length === 0) return errorResponse('ALBUM_NOT_FOUND');

      const existing = await supabase.select(
        'photos',
        { select: 'id', id: `in.(${items.map((i) => i.photo_id).join(',')})` },
        jwt,
      );
      if (!existing.ok) return errorResponse(existing.code);
      if (existing.data.length > 0) return errorResponse('CONFLICT');

      // Per-file limit first; those items never reach the quota RPC.
      const maxUpload = Number(cfg.max_upload_bytes);
      const tooLarge = new Set(
        items.filter((i) => hasOversizedFile(i.files, maxUpload)).map((i) => i.photo_id),
      );
      const forRpc = items
        .filter((i) => !tooLarge.has(i.photo_id))
        .map((i) => ({ photo_id: i.photo_id, bytes: itemBytes(i.files) }));

      const rpc = await supabase.rpc<RpcResult>('reserve_uploads', { p_items: forRpc }, jwt);
      if (!rpc.ok) return errorResponse(rpc.code);
      const verdict = new Map(rpc.data.results.map((r) => [r.photo_id, r]));

      const out: { photo_id: string; ok: boolean; code?: ItemCode; uploads?: UploadTarget[] }[] = [];
      let accepted = 0;
      for (const item of items) {
        if (tooLarge.has(item.photo_id)) {
          out.push({ photo_id: item.photo_id, ok: false, code: 'FILE_TOO_LARGE' });
          continue;
        }
        const v = verdict.get(item.photo_id);
        if (v?.ok === true) {
          out.push({ photo_id: item.photo_id, ok: true, uploads: await presignItem(deps.storage, item) });
          accepted++;
        } else {
          out.push({
            photo_id: item.photo_id,
            ok: false,
            code: v?.code === 'FILE_TOO_LARGE' ? 'FILE_TOO_LARGE' : 'STORAGE_FULL',
          });
        }
      }

      const { used_bytes, reserved_bytes, hard, warn, level } = rpc.data;
      return jsonResponse(
        { items: out, used_bytes, reserved_bytes, hard, warn, level },
        accepted === 0 ? ERROR_STATUS.STORAGE_FULL : 200,
      );
    },
  };
}
