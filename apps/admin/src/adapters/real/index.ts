/**
 * Real adapter set: supabase-js (anon key) for sign-in, PostgREST for the catalog, fetch for the Worker.
 * The publish status reader fetches the public site's `/_publish.json`.
 */
import { createClient } from '@supabase/supabase-js';
import type { AdminEnv } from '../../env';
import { ApiError, systemClock, systemIds, type Ports } from '../../ports';
import { createRealPublishStatus } from './publishStatus';
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
      // flowType is explicit: auth-js 2.117.2 defaults to 'implicit'. See the header of ./auth.ts.
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    }).auth;

  // Bearer token from the session at call time: supabase-js refreshes it when needed.
  const getToken = async (): Promise<string | null> => (await auth.getSession()).data.session?.access_token ?? null;
  const fetchDep = deps.fetch === undefined ? {} : { fetch: deps.fetch };

  const rest = createRest({ baseUrl: env.supabaseUrl, anonKey: env.supabaseAnonKey, getToken, ...fetchDep });
  const redirectTo = typeof location === 'undefined' ? undefined : `${location.origin}/prihlaseni`;

  return {
    auth: createRealAuth(auth, {
      // UX-only: the is_admin() RPC under the user's JWT (the same function RLS and the Worker use).
      isAdminUser: async () => {
        try {
          return (await rest.rpc('is_admin')) === true;
        } catch (error) {
          if (error instanceof ApiError && error.code === 'NOT_ADMIN') return false;
          throw error;
        }
      },
      ...(redirectTo === undefined ? {} : { redirectTo }),
    }),
    catalog: createRealCatalog(rest),
    api: createRealApi({ baseUrl: env.apiBaseUrl, getToken, ...fetchDep }),
    upload: createXhrUpload(),
    publishStatus: createRealPublishStatus({ siteUrl: env.publicSiteUrl, ...fetchDep }),
    clock: systemClock,
    ids: systemIds,
  };
}
