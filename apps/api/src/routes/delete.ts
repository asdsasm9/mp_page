/**
 * POST /photos/delete (WP-4 section 4.7, D-6). Rows go first through `delete_photos` (the stored total
 * drops, covers clear), then every object under `photos/<id>/` is removed immediately, orphans included.
 * An id whose storage deletion fails is reported in `failed`; reconcile removes the leftovers later.
 */
import {
  DeleteRequestSchema,
  apiCodeFromZodError,
  photoPrefix,
  type StorageAdapter,
} from '@mp/shared';
import type { Route } from '../index';
import { errorResponse, jsonResponse, readJsonBody } from '../http';

async function removePrefix(storage: StorageAdapter, id: string): Promise<number> {
  let count = 0;
  let cursor: string | undefined;
  do {
    const page = await storage.list(photoPrefix(id), cursor === undefined ? {} : { cursor });
    if (page.objects.length > 0) {
      await storage.delete(page.objects.map((o) => o.key));
      count += page.objects.length;
    }
    cursor = page.cursor;
  } while (cursor !== undefined);
  return count;
}

export function createDeleteRoute(deps: { storage: StorageAdapter }): Route {
  return {
    methods: ['POST'],
    handler: async ({ request, supabase, jwt }) => {
      const body = await readJsonBody(request);
      if (!body.ok) return errorResponse(body.code);
      const parsed = DeleteRequestSchema.safeParse(body.value);
      if (!parsed.success) return errorResponse(apiCodeFromZodError(parsed.error));
      const ids = [...new Set(parsed.data.ids)];

      const rpc = await supabase.rpc<{ deleted: { id: string }[] }>('delete_photos', { p_ids: ids }, jwt);
      if (!rpc.ok) return errorResponse(rpc.code);

      let objectsDeleted = 0;
      const failed: string[] = [];
      for (const row of rpc.data.deleted) {
        try {
          objectsDeleted += await removePrefix(deps.storage, row.id);
        } catch {
          failed.push(row.id);
        }
      }
      return jsonResponse(
        { deleted: rpc.data.deleted.length, objectsDeleted, failed, publishRecommended: true },
        200,
      );
    },
  };
}
