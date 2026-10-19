/**
 * API Worker contract (WP-4 section 4.5 and 4.7): request and response schemas, error codes with
 * HTTP statuses, and the upload file plan. Pure; used by the Worker and by the admin client.
 *
 * Refinements report the Worker error code as the issue message (see apiCodeFromZodError), so
 * the Worker can map a failed parse to INVALID_ID, INVALID_ITEMS or INVALID_REQUEST without
 * echoing any input.
 */
import { z } from 'zod';
import { validateAlt } from './alt';
import { API_ERROR_CODES, type ApiErrorCode } from './errors';
import { allKeys, jpegKey, isValidPhotoId, masterKey, ogKey, webpKey, type WebpTier } from './keys';
import { MASTER_MAX_EDGE, PhotoVariantsSchema, variantPlan, type PhotoVariants } from './variants';

// ---------------------------------------------------------------- error codes

/** Codes the Worker raises itself, on top of the database codes in ApiErrorCode. */
export const WORKER_ONLY_ERROR_CODES = [
  'UNAUTHENTICATED',
  'INVALID_REQUEST',
  'INVALID_ID',
  'INVALID_ITEMS',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'PAYLOAD_TOO_LARGE',
  'UPSTREAM_ERROR',
  'CONFIG_ERROR',
  'PUBLISH_FAILED',
  'SNAPSHOT_EMPTY',
  'INTERNAL',
] as const;

export type WorkerOnlyErrorCode = (typeof WORKER_ONLY_ERROR_CODES)[number];
export type WorkerErrorCode = ApiErrorCode | WorkerOnlyErrorCode;

export const WORKER_ERROR_CODES: readonly WorkerErrorCode[] = [...API_ERROR_CODES, ...WORKER_ONLY_ERROR_CODES];

export function isWorkerErrorCode(value: unknown): value is WorkerErrorCode {
  return typeof value === 'string' && (WORKER_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Default HTTP status per code. UPSTREAM_ERROR is 502; the auth check fails closed with 503 when
 * Supabase is unreachable (the Worker overrides the status for that case). STORAGE_FULL is the
 * status when nothing at all could be reserved or registered.
 */
export const ERROR_STATUS: Record<WorkerErrorCode, number> = {
  UNAUTHENTICATED: 401,
  NOT_ADMIN: 403,
  INVALID_REQUEST: 400,
  INVALID_ID: 400,
  INVALID_ITEMS: 400,
  NOT_FOUND: 404,
  ALBUM_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  PAYLOAD_TOO_LARGE: 413,
  BATCH_TOO_LARGE: 413,
  FILE_TOO_LARGE: 413,
  STORAGE_FULL: 409,
  CONFLICT: 409,
  KEY_MISMATCH: 422,
  BYTES_MISMATCH: 422,
  PUBLISH_TOO_SOON: 429,
  UPSTREAM_ERROR: 502,
  PUBLISH_FAILED: 502,
  CONFIG_ERROR: 500,
  SNAPSHOT_EMPTY: 409,
  INTERNAL: 500,
};

export const ErrorBodySchema = z
  .object({ error: z.string().refine(isWorkerErrorCode), retryAfter: z.number().int().nonnegative().optional() })
  .strict();
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

/** The Worker code for a failed parse: the first issue whose message is a Worker code, else INVALID_REQUEST. */
export function apiCodeFromZodError(err: z.ZodError): WorkerErrorCode {
  for (const issue of err.issues) {
    if (issue.message === 'INVALID_ID' || issue.message === 'INVALID_ITEMS' || issue.message === 'BATCH_TOO_LARGE') {
      return issue.message;
    }
  }
  return 'INVALID_REQUEST';
}

// ---------------------------------------------------------------- upload file plan

export type UploadKind = 'master' | 'webp' | 'jpeg' | 'og';

export interface PlannedFile {
  kind: UploadKind;
  tier?: WebpTier;
  key: string;
  contentType: string;
}

/** Content types are fixed by kind; the client never chooses them. */
export const CONTENT_TYPE_BY_KIND: Record<UploadKind, string> = {
  master: 'image/jpeg',
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  og: 'image/jpeg',
};

/** Cache-Control signed into every photo upload. */
export const PHOTO_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Exactly the files one photo consists of: master, WebP tiers, 1600 JPEG, OG. Keys come from the key helpers. */
export function planUploadFiles(photoId: string, width: number, height: number): PlannedFile[] {
  const plan = variantPlan(width, height);
  return [
    { kind: 'master', key: masterKey(photoId), contentType: CONTENT_TYPE_BY_KIND.master },
    ...plan.webp.map((e) => ({
      kind: 'webp' as const,
      tier: e.tier as WebpTier,
      key: webpKey(photoId, e.tier as WebpTier),
      contentType: CONTENT_TYPE_BY_KIND.webp,
    })),
    { kind: 'jpeg', key: jpegKey(photoId), contentType: CONTENT_TYPE_BY_KIND.jpeg },
    { kind: 'og', key: ogKey(photoId), contentType: CONTENT_TYPE_BY_KIND.og },
  ];
}

const within1 = (a: number, b: number) => Math.abs(a - b) <= 1;

/** Structure must equal variantPlan exactly (same tiers); dimensions may differ by 1 px (encoder rounding). */
export function variantsMatchPlan(variants: PhotoVariants, width: number, height: number): boolean {
  const plan = variantPlan(width, height);
  const same = (a: { w: number; h: number }, b: { w: number; h: number }) => within1(a.w, b.w) && within1(a.h, b.h);
  if (variants.webp.length !== plan.webp.length) return false;
  for (let i = 0; i < plan.webp.length; i++) {
    const v = variants.webp[i]!;
    const p = plan.webp[i]!;
    if (v.tier !== p.tier || !same(v, p)) return false;
  }
  return same(variants.master, plan.master) && same(variants.jpeg, plan.jpeg) && same(variants.og, plan.og);
}

// ---------------------------------------------------------------- shared pieces

const uuid = z.string().refine(isValidPhotoId, 'INVALID_ID');
const posInt = z.number().int().positive();
const nonNegInt = z.number().int().nonnegative();
const isoDateTime = z.iso.datetime({ offset: true });
const quotaLevel = z.enum(['ok', 'warn', 'full']);
const kindSchema = z.enum(['master', 'webp', 'jpeg', 'og']);
const tierSchema = z.union([z.literal(480), z.literal(960), z.literal(1600), z.literal(2400)]);

/** Pattern for legacy_key (WP-6 migration only). */
export const LEGACY_KEY_RE = /^(weddings|portraits|couples)\/[a-z0-9_]+\/[0-9]+\.jpg$/;

// ---------------------------------------------------------------- GET /storage

export const StorageResponseSchema = z
  .object({
    used_bytes: nonNegInt,
    reserved_bytes: nonNegInt,
    hard: nonNegInt,
    warn: nonNegInt,
    photo_count: nonNegInt,
    level: quotaLevel,
  })
  .strict();
export type StorageResponse = z.infer<typeof StorageResponseSchema>;

// ---------------------------------------------------------------- POST /uploads/reserve

export const ReserveFileSchema = z
  .object({ kind: kindSchema, tier: tierSchema.optional(), bytes: posInt })
  .strict();

export const ReserveItemSchema = z
  .object({
    photo_id: uuid,
    width: posInt,
    height: posInt,
    files: z.array(ReserveFileSchema).min(1),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (Math.max(item.width, item.height) > MASTER_MAX_EDGE) {
      ctx.addIssue({ code: 'custom', message: 'INVALID_ITEMS', path: ['width'] });
      return;
    }
    if (!filesMatchPlan(item.files, item.width, item.height)) {
      ctx.addIssue({ code: 'custom', message: 'INVALID_ITEMS', path: ['files'] });
    }
  });

/** True when `files` is exactly the planned set of kinds and tiers (no extras, no missing, no repeats). */
export function filesMatchPlan(
  files: ReadonlyArray<{ kind: UploadKind; tier?: number | undefined }>,
  width: number,
  height: number,
): boolean {
  const id = '00000000-0000-4000-8000-000000000000';
  const wanted = planUploadFiles(id, width, height).map((f) => `${f.kind}:${f.tier ?? ''}`).sort();
  const got = files.map((f) => `${f.kind}:${f.tier ?? ''}`).sort();
  return got.length === wanted.length && wanted.every((w, i) => w === got[i]);
}

export const ReserveRequestSchema = z
  .object({
    album_id: z.string().refine(isValidPhotoId, 'INVALID_ID'),
    items: z.array(ReserveItemSchema).min(1),
  })
  .strict()
  .superRefine((req, ctx) => {
    const seen = new Set<string>();
    for (const [i, it] of req.items.entries()) {
      if (seen.has(it.photo_id)) ctx.addIssue({ code: 'custom', message: 'INVALID_ITEMS', path: ['items', i, 'photo_id'] });
      seen.add(it.photo_id);
    }
  });
export type ReserveRequest = z.infer<typeof ReserveRequestSchema>;

export const UploadTargetSchema = z
  .object({
    kind: kindSchema,
    tier: tierSchema.optional(),
    key: z.string().min(1),
    method: z.literal('PUT'),
    url: z.string().min(1),
    headers: z.record(z.string(), z.string()),
    expiresAt: isoDateTime,
  })
  .strict();
export type UploadTarget = z.infer<typeof UploadTargetSchema>;

export const ReserveItemResultSchema = z
  .object({
    photo_id: z.string(),
    ok: z.boolean(),
    code: z.enum(['FILE_TOO_LARGE', 'STORAGE_FULL']).optional(),
    uploads: z.array(UploadTargetSchema).optional(),
  })
  .strict()
  .refine((r) => (r.ok ? r.code === undefined && r.uploads !== undefined : r.code !== undefined && r.uploads === undefined), {
    message: 'accepted items carry uploads and no code; refused items carry a code and no uploads',
  });

export const ReserveResponseSchema = z
  .object({
    items: z.array(ReserveItemResultSchema),
    used_bytes: nonNegInt,
    reserved_bytes: nonNegInt,
    hard: nonNegInt,
    warn: nonNegInt,
    level: quotaLevel,
  })
  .strict();
export type ReserveResponse = z.infer<typeof ReserveResponseSchema>;

// ---------------------------------------------------------------- POST /uploads/commit

export const CommitRequestSchema = z
  .object({
    photo_id: uuid,
    album_id: uuid,
    width: posInt,
    height: posInt,
    dominant_color: z.string().regex(/^#[0-9a-f]{6}$/).optional(),
    alt: z
      .string()
      .refine((a) => validateAlt(a).ok, 'INVALID_REQUEST')
      .optional(),
    legacy_key: z.string().regex(LEGACY_KEY_RE).optional(),
    variants: PhotoVariantsSchema,
    bytes_total: posInt,
  })
  .strict()
  .superRefine((req, ctx) => {
    if (Math.max(req.width, req.height) > MASTER_MAX_EDGE || !variantsMatchPlan(req.variants, req.width, req.height)) {
      ctx.addIssue({ code: 'custom', message: 'INVALID_REQUEST', path: ['variants'] });
    }
  });
export type CommitRequest = z.infer<typeof CommitRequestSchema>;

/** Every storage key a commit claims, in a stable order. */
export function commitKeys(req: Pick<CommitRequest, 'photo_id' | 'variants'>): string[] {
  return allKeys(req.photo_id, req.variants);
}

export const PhotoRowSchema = z
  .object({
    id: z.string(),
    album_id: z.string(),
    master_key: z.string(),
    width: posInt,
    height: posInt,
    variants: PhotoVariantsSchema,
    bytes_total: nonNegInt,
    dominant_color: z.string().nullable(),
    alt: z.string().nullable(),
    caption: z.string().nullable(),
    sort: z.number().int(),
    legacy_key: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

export const CommitResponseSchema = z.object({ photo: PhotoRowSchema, already_existed: z.boolean() }).strict();
export type CommitResponse = z.infer<typeof CommitResponseSchema>;

// ---------------------------------------------------------------- POST /photos/delete

export const DeleteRequestSchema = z.object({ ids: z.array(uuid).min(1).max(200, 'BATCH_TOO_LARGE') }).strict();
export type DeleteRequest = z.infer<typeof DeleteRequestSchema>;

export const DeleteResponseSchema = z
  .object({
    deleted: nonNegInt,
    objectsDeleted: nonNegInt,
    failed: z.array(z.string()),
    publishRecommended: z.literal(true),
  })
  .strict();
export type DeleteResponse = z.infer<typeof DeleteResponseSchema>;

// ---------------------------------------------------------------- POST /storage/reconcile

export const ReconcileRequestSchema = z.object({ apply: z.boolean().optional(), cursor: z.string().min(1).max(1024).optional() }).strict();
export type ReconcileRequest = z.infer<typeof ReconcileRequestSchema>;

export const ReconcileResponseSchema = z
  .object({
    r2: z.object({ objects: nonNegInt, bytes: nonNegInt }).strict(),
    db: z.object({ photos: nonNegInt, bytes: nonNegInt }).strict(),
    orphans: z.array(z.object({ id: z.string(), objects: nonNegInt, bytes: nonNegInt }).strict()),
    missing: z.array(z.object({ id: z.string(), keys: z.array(z.string()) }).strict()),
    sizeMismatch: z.array(
      z.object({ id: z.string(), key: z.string(), expected: nonNegInt, actual: nonNegInt }).strict(),
    ),
    unknownKeys: z.array(z.string()),
    applied: z.boolean(),
    deleted: nonNegInt,
    cursor: z.string().optional(),
  })
  .strict();
export type ReconcileResponse = z.infer<typeof ReconcileResponseSchema>;

// ---------------------------------------------------------------- POST /publish

/** No body is expected; an empty object is tolerated. */
export const PublishRequestSchema = z.object({}).strict();

export const PublishResponseSchema = z
  .object({
    log_id: z.string(),
    snapshot_generated_at: isoDateTime,
    counts: z.object({ categories: nonNegInt, albums: nonNegInt, photos: nonNegInt }).strict(),
    snapshot_bytes: nonNegInt,
    pending_seen: nonNegInt,
  })
  .strict();
export type PublishResponse = z.infer<typeof PublishResponseSchema>;
