/**
 * Real adapter set: supabase-js (anon key) for sign-in, PostgREST for the catalog, fetch for the Worker.
 * The publish status reader belongs to a later work package (WP5-25); until then it answers with the Czech
 * "not available" error instead of pretending to work.
 */
import { createClient } from '@supabase/supabase-js';
import type { AdminEnv } from '../../env';
import { AdapterUnavailableError, systemClock, systemIds, type Ports } from '../../ports';
import { createRealApi } from './api';
import { createRealAuth, type SupabaseAuthLike } from './auth';
import { createRealCatalog } from './catalog';
import { createRest, type FetchFn } from './http';
import { createXhrUpload } from './upload';

export interface RealPortsDeps {
  /** Replaces supabase.auth (tests). */
  auth?: SupabaseAuthLike;
  fetch?: FetchFn;
}

export function createRealPorts(env: AdminEnv, deps: RealPortsDeps = {}): Ports {
  const auth: SupabaseAuthLike =
    deps.auth ??
    createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    }).auth;

  // Bearer token from the session at call time: supabase-js refreshes it when needed.
  const getToken = async (): Promise<string | null> => (await auth.getSession()).data.session?.access_token ?? null;
  const fetchDep = deps.fetch === undefined ? {} : { fetch: deps.fetch };

  const rest = createRest({ baseUrl: env.supabaseUrl, anonKey: env.supabaseAnonKey, getToken, ...fetchDep });
  const redirectTo = typeof location === 'undefined' ? undefined : `${location.origin}/prihlaseni`;

  return {
    auth: createRealAuth(auth, {
      isAdminUser: async (userId) =>
        (await rest.select<{ user_id: string }>('admins', { select: 'user_id', user_id: `eq.${userId}`, limit: '1' }))
          .length > 0,
      ...(redirectTo === undefined ? {} : { redirectTo }),
    }),
    catalog: createRealCatalog(rest),
    api: createRealApi({ baseUrl: env.apiBaseUrl, getToken, ...fetchDep }),
    upload: createXhrUpload(),
    publishStatus: {
      read: () => Promise.reject(new AdapterUnavailableError()),
    },
    clock: systemClock,
    ids: systemIds,
  };
}
