/** GET /storage (WP-4 section 4.7): the database's own storage_usage result, unchanged. */
import type { Route } from '../index';
import { errorResponse, jsonResponse } from '../http';

export const storageRoute: Route = {
  methods: ['GET'],
  handler: async ({ supabase, jwt }) => {
    const res = await supabase.rpc<Record<string, unknown>>('storage_usage', {}, jwt);
    if (!res.ok) return errorResponse(res.code);
    return jsonResponse(res.data, 200);
  },
};
