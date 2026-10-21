/**
 * POST /storage/reconcile (WP-4 section 4.7, D-7). Compares the photo rows with the objects under
 * `photos/` and reports drift: orphans, rows with missing objects, size mismatches and unknown keys.
 * With `apply: true` it deletes only orphan objects that are old enough and not reserved. It never
 * edits database rows (the columns are not writable by design) and never touches keys outside
 * `photos/`. There is no "use the real value" correction: the database total is the sum of rows.
 *
 * Paging: at most `pageBudget` list pages per call. When more remain the response carries an opaque
 * `cursor`. Objects are grouped by their first path segment (the photo id); the last group of a call
 * is completed with a prefix listing so a photo is never judged on half its objects, and rows are
 * checked in the call whose id range covers them. Summing the reports of all calls equals one run.
 */
import {
  PhotoVariantsSchema,
  ORPHAN_MIN_AGE_MS,
  ReconcileRequestSchema,
  allKeys,
  apiCodeFromZodError,
  isValidPhotoId,
  parseKey,
  type ReconcileResponse,
  type StorageAdapter,
  type StorageObjectInfo,
  variantBytes,
} from '@mp/shared';
import type { Route } from '../index';
import { errorResponse, jsonResponse, readJsonBody } from '../http';

const PHOTOS_PREFIX = 'photos/';
const DEFAULT_PAGE_BUDGET = 20;
const DEFAULT_PAGE_SIZE = 1000;

export interface ReconcileDeps {
  storage: StorageAdapter;
  /** Clock (default: real time). */
  now?: () => Date;
  /** List pages per call (default 20). */
  pageBudget?: number;
  /** Objects per list page (default and maximum 1000). */
  pageSize?: number;
}

interface Cursor {
  /** Adapter list cursor to continue from. */
  c: string;
  /** Last fully processed id segment; the next call skips segments up to and including it. */
  after: string;
}

function encodeCursor(c: Cursor): string {
  return btoa(JSON.stringify(c));
}

function decodeCursor(value: string): Cursor | null {
  try {
    const parsed = JSON.parse(atob(value)) as Partial<Cursor> | null;
    if (parsed && typeof parsed.c === 'string' && typeof parsed.after === 'string') {
      return { c: parsed.c, after: parsed.after };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** First path segment under `photos/` (the id for well-formed keys). */
const segmentOf = (key: string): string => key.slice(PHOTOS_PREFIX.length).split('/')[0]!;
const hasSubpath = (key: string): boolean => key.slice(PHOTOS_PREFIX.length).includes('/');

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

interface Row {
  id: string;
  bytes_total: number;
  variants: unknown;
}

export function createReconcileRoute(deps: ReconcileDeps): Route {
  const { storage } = deps;
  const now = deps.now ?? (() => new Date());
  const pageBudget = Math.max(1, deps.pageBudget ?? DEFAULT_PAGE_BUDGET);
  const pageSize = Math.min(Math.max(1, deps.pageSize ?? DEFAULT_PAGE_SIZE), DEFAULT_PAGE_SIZE);

  return {
    methods: ['POST'],
    handler: async ({ request, supabase, jwt }) => {
      const body = await readJsonBody(request, { allowEmpty: true });
      if (!body.ok) return errorResponse(body.code);
      const parsed = ReconcileRequestSchema.safeParse(body.value);
      if (!parsed.success) return errorResponse(apiCodeFromZodError(parsed.error));
      const apply = parsed.data.apply === true;
      let state: Cursor | null = null;
      if (parsed.data.cursor !== undefined) {
        state = decodeCursor(parsed.data.cursor);
        if (!state) return errorResponse('INVALID_REQUEST');
      }

      const rowsRes = await supabase.select<Row>(
        'photos',
        { select: 'id,bytes_total,variants', order: 'id.asc' },
        jwt,
      );
      if (!rowsRes.ok) return errorResponse(rowsRes.code);
      const resRes = await supabase.select<{ photo_id: string; expires_at: string }>(
        'upload_reservations',
        { select: 'photo_id,expires_at' },
        jwt,
      );
      if (!resRes.ok) return errorResponse(resRes.code);

      const rows = rowsRes.data;
      const rowIds = new Set(rows.map((r) => r.id));
      const nowMs = now().getTime();
      const reserved = new Set(
        resRes.data.filter((r) => Date.parse(r.expires_at) > nowMs).map((r) => r.photo_id),
      );

      // ---- list this call's slice of photos/
      let objects: StorageObjectInfo[] = [];
      let listCursor: string | undefined = state?.c;
      let pages = 0;
      try {
        do {
          const page = await storage.list(
            PHOTOS_PREFIX,
            listCursor === undefined ? { limit: pageSize } : { limit: pageSize, cursor: listCursor },
          );
          objects.push(...page.objects);
          listCursor = page.cursor;
          pages++;
        } while (listCursor !== undefined && pages < pageBudget);

        if (state) objects = objects.filter((o) => segmentOf(o.key) > state!.after);
      } catch {
        return errorResponse('UPSTREAM_ERROR');
      }

      const more = listCursor !== undefined;
      let hi: string | undefined;
      if (more) {
        const last = objects.at(-1);
        hi = last === undefined ? state?.after : segmentOf(last.key);
        if (last !== undefined && hasSubpath(last.key)) {
          // Complete the trailing group so it is judged on all of its objects.
          try {
            const group = await listAll(storage, `${PHOTOS_PREFIX}${hi}/`);
            objects = [...objects.filter((o) => segmentOf(o.key) !== hi), ...group];
          } catch {
            return errorResponse('UPSTREAM_ERROR');
          }
        }
      }

      // ---- group by segment
      const groups = new Map<string, StorageObjectInfo[]>();
      for (const o of objects) {
        const seg = segmentOf(o.key);
        const list = groups.get(seg);
        if (list) list.push(o);
        else groups.set(seg, [o]);
      }
      const byKey = new Map(objects.map((o) => [o.key, o]));

      const report: ReconcileResponse = {
        r2: { objects: objects.length, bytes: objects.reduce((a, o) => a + o.bytes, 0) },
        db: { photos: rows.length, bytes: rows.reduce((a, r) => a + Number(r.bytes_total), 0) },
        orphans: [],
        missing: [],
        sizeMismatch: [],
        unknownKeys: [],
        applied: apply,
        deleted: 0,
      };

      const cutoff = nowMs - ORPHAN_MIN_AGE_MS;
      const orphanKeys: string[][] = [];
      for (const [seg, list] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        if (!isValidPhotoId(seg)) {
          report.unknownKeys.push(...list.map((o) => o.key));
          continue;
        }
        if (rowIds.has(seg)) {
          report.unknownKeys.push(...list.filter((o) => parseKey(o.key) === null).map((o) => o.key));
          continue;
        }
        if (reserved.has(seg)) continue;
        const old = list.every((o) => o.uploaded !== undefined && Date.parse(o.uploaded) < cutoff);
        if (!old) continue;
        report.orphans.push({ id: seg, objects: list.length, bytes: list.reduce((a, o) => a + o.bytes, 0) });
        orphanKeys.push(list.map((o) => o.key));
      }

      // ---- rows whose id falls in this call's range
      for (const row of rows) {
        if (state && row.id <= state.after) continue;
        if (hi !== undefined && row.id > hi) continue;
        const variants = PhotoVariantsSchema.safeParse(row.variants);
        if (!variants.success) continue;
        const v = variants.data;
        const expected = variantBytes(v);
        const missingKeys: string[] = [];
        for (const [i, key] of allKeys(row.id, v).entries()) {
          const found = byKey.get(key);
          if (!found) missingKeys.push(key);
          else if (found.bytes !== expected[i]) {
            report.sizeMismatch.push({ id: row.id, key, expected: expected[i]!, actual: found.bytes });
          }
        }
        if (missingKeys.length > 0) report.missing.push({ id: row.id, keys: missingKeys });
      }

      // ---- apply: orphans only; a failed group stays in the report and is retried by the next run
      if (apply) {
        for (const keys of orphanKeys) {
          try {
            await storage.delete(keys);
            report.deleted += keys.length;
          } catch {
            /* reported again by the next run */
          }
        }
      }

      if (more && listCursor !== undefined && hi !== undefined) {
        report.cursor = encodeCursor({ c: listCursor, after: hi });
      }
      return jsonResponse(report, 200);
    },
  };
}
