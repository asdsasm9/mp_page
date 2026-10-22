/**
 * Daily Supabase keepalive (WP-4 section 4.7). Calls the anon-callable `keepalive()` RPC with the
 * anon key only (no user token). Never throws: a failure is logged without detail and returned.
 */
import { parseEnv, type EnvOptions, type RawEnv } from './env';
import type { FetchFn } from './supabase';

export interface KeepaliveDeps {
  fetch?: FetchFn;
  env?: EnvOptions;
  timeoutMs?: number;
}

export async function runKeepalive(rawEnv: RawEnv | undefined, deps: KeepaliveDeps = {}): Promise<boolean> {
  const parsed = parseEnv(rawEnv, deps.env);
  if (!parsed.ok) {
    console.error(`KEEPALIVE_FAILED config invalid or missing: ${parsed.invalid.join(', ')}`);
    return false;
  }
  const { supabaseUrl, supabaseAnonKey } = parsed.config;
  const doFetch: FetchFn = deps.fetch ?? ((input, init) => fetch(input, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 8000);
  try {
    const res = await doFetch(`${supabaseUrl}/rest/v1/rpc/keepalive`, {
      method: 'POST',
      headers: { apikey: supabaseAnonKey, authorization: `Bearer ${supabaseAnonKey}`, 'content-type': 'application/json' },
      body: '{}',
      signal: controller.signal,
    });
    await res.body?.cancel().catch(() => undefined);
    if (!res.ok) {
      console.error(`KEEPALIVE_FAILED status ${res.status}`);
      return false;
    }
    return true;
  } catch {
    console.error('KEEPALIVE_FAILED request error');
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Cloudflare `scheduled` handler body; T-90 exports it from the Worker entry. */
export function createScheduled(deps: KeepaliveDeps = {}) {
  return async (_event: unknown, env: RawEnv): Promise<void> => {
    await runKeepalive(env, deps);
  };
}
