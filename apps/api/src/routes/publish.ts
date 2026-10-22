/**
 * POST /publish (WP-4 section 4.7). Steps: `request_publish` (admin check, 1 per 60 s, creates the
 * log row), build and store the snapshot, POST the deploy hook (URL only from the secret
 * config), then `record_publish`. A failure after the log row exists is recorded as `failed` with a
 * short code (never a URL) and leaves `pending_changes` unchanged. Completion of the Pages build is
 * not known here; the admin polls `/_publish.json`.
 */
import {
  PublishResponseSchema,
  SnapshotEmptyError,
  type StorageAdapter,
  type WorkerErrorCode,
} from '@mp/shared';
import type { Route } from '../index';
import { errorResponse, jsonResponse } from '../http';
import { PublishServiceError, buildAndStoreSnapshot } from '../publish-service';
import type { FetchFn, SupabaseClient } from '../supabase';

export interface PublishRouteDeps {
  /** Public bucket (snapshot). */
  publicBucket: StorageAdapter;
  now?: () => Date;
  /** Injected fetch for the deploy hook only (default: global fetch). */
  hookFetch?: FetchFn;
  hookTimeoutMs?: number;
}

const DEFAULT_HOOK_TIMEOUT_MS = 10_000;

async function triggerHook(url: string, doFetch: FetchFn, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(url, { method: 'POST', redirect: 'manual', signal: controller.signal });
    await res.body?.cancel().catch(() => undefined);
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function recordFailed(supabase: SupabaseClient, jwt: string, logId: string, error: string): Promise<void> {
  await supabase.rpc(
    'record_publish',
    { p_log_id: logId, p_status: 'failed', p_pending_seen: null, p_albums: null, p_photos: null, p_bytes: null, p_error: error },
    jwt,
  );
}

export function createPublishRoute(deps: PublishRouteDeps): Route {
  const now = deps.now ?? (() => new Date());
  return {
    methods: ['POST'],
    handler: async ({ config, supabase, jwt }) => {
      const started = await supabase.rpc<{ log_id: string; pending_seen: number }>('request_publish', {}, jwt);
      if (!started.ok) {
        return started.code === 'PUBLISH_TOO_SOON' && started.retryAfter !== undefined
          ? errorResponse(started.code, { retryAfter: started.retryAfter, headers: { 'retry-after': String(started.retryAfter) } })
          : errorResponse(started.code);
      }
      const { log_id: logId, pending_seen: pendingSeen } = started.data;

      let result;
      try {
        result = await buildAndStoreSnapshot({ supabase, publicBucket: deps.publicBucket, now }, jwt);
      } catch (e) {
        let code: WorkerErrorCode = 'UPSTREAM_ERROR';
        if (e instanceof SnapshotEmptyError) code = 'SNAPSHOT_EMPTY';
        else if (e instanceof PublishServiceError) code = e.code;
        await recordFailed(supabase, jwt, logId, code);
        return errorResponse(code);
      }

      const hookOk = await triggerHook(
        config.pagesDeployHookUrl,
        deps.hookFetch ?? ((input, init) => fetch(input, init)),
        deps.hookTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
      );
      if (!hookOk) {
        await recordFailed(supabase, jwt, logId, 'DEPLOY_HOOK_FAILED');
        return errorResponse('PUBLISH_FAILED');
      }

      const recorded = await supabase.rpc('record_publish', {
        p_log_id: logId,
        p_status: 'ok',
        p_pending_seen: pendingSeen,
        p_albums: result.counts.albums,
        p_photos: result.counts.photos,
        p_bytes: result.snapshotBytes,
        p_error: null,
      }, jwt);
      if (!recorded.ok) return errorResponse(recorded.code);

      return jsonResponse(
        PublishResponseSchema.parse({
          log_id: logId,
          snapshot_generated_at: result.snapshot.generatedAt,
          counts: result.counts,
          snapshot_bytes: result.snapshotBytes,
          pending_seen: pendingSeen,
        }),
        200,
      );
    },
  };
}
