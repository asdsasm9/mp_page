import { authenticate } from './auth';
import { createSupabaseClient, type FetchFn, type SupabaseClient } from './supabase';
import { applyCors, checkOrigin, deniedOriginResponse, preflightResponse } from './cors';
import { parseEnv, type Config, type EnvOptions, type RawEnv } from './env';
import { errorResponse, jsonResponse, withBaseHeaders } from './http';

export interface RouteContext {
  request: Request;
  config: Config;
  /** Supabase client bound to the injected fetch and the anon key. */
  supabase: SupabaseClient;
  /** The caller's verified admin JWT; empty string on routes with `auth: false`. */
  jwt: string;
}

export interface Route {
  /** Allowed methods (OPTIONS is handled by CORS and need not be listed). */
  methods: readonly string[];
  /** Require an admin Bearer token (default true). Only /health opts out. */
  auth?: boolean;
  handler: (ctx: RouteContext) => Response | Promise<Response>;
}

export interface AppDeps {
  /** Extra routes by exact path; later work packages add theirs here. */
  routes?: Record<string, Route>;
  env?: EnvOptions;
  /** Injected fetch for Supabase calls (default: global fetch). */
  fetch?: FetchFn;
}

const healthRoute: Route = { methods: ['GET'], auth: false, handler: () => jsonResponse({ ok: true }, 200) };

/**
 * Request pipeline: env check, CORS (disallowed Origin 403, preflight 204 before auth), routing
 * (404, 405 with Allow), handler. Every response gets no-store, nosniff and Vary: Origin.
 */
export function createApp(deps: AppDeps = {}) {
  const routes: Record<string, Route> = { '/health': healthRoute, ...deps.routes };

  async function handle(request: Request, rawEnv: RawEnv | undefined): Promise<Response> {
    const parsed = parseEnv(rawEnv, deps.env);
    if (!parsed.ok) {
      // Names only, never values.
      console.error(`CONFIG_ERROR invalid or missing: ${parsed.invalid.join(', ')}`);
      return errorResponse('CONFIG_ERROR');
    }
    const { config } = parsed;

    const origin = checkOrigin(request, config.allowedOrigins);
    if (origin.kind === 'denied') return deniedOriginResponse();
    if (request.method === 'OPTIONS') return preflightResponse(origin);

    const { pathname } = new URL(request.url);
    const route = Object.hasOwn(routes, pathname) ? routes[pathname]! : undefined;
    if (!route) return applyCors(errorResponse('NOT_FOUND'), origin);
    if (!route.methods.includes(request.method)) {
      return applyCors(
        errorResponse('METHOD_NOT_ALLOWED', { headers: { allow: [...route.methods, 'OPTIONS'].join(', ') } }),
        origin,
      );
    }

    const supabase = createSupabaseClient({
      supabaseUrl: config.supabaseUrl,
      anonKey: config.supabaseAnonKey,
      fetch: deps.fetch ?? ((input, init) => fetch(input, init)),
    });

    let response: Response;
    try {
      let jwt = '';
      if (route.auth !== false) {
        const auth = await authenticate(request, supabase);
        if (!auth.ok) return applyCors(withBaseHeaders(auth.response), origin);
        jwt = auth.jwt;
      }
      response = await route.handler({ request, config, supabase, jwt });
    } catch {
      // No detail in the body or the log: errors may carry tokens or URLs.
      console.error('INTERNAL unhandled error in route handler');
      response = errorResponse('INTERNAL');
    }
    return applyCors(withBaseHeaders(response), origin);
  }

  return { fetch: handle };
}

const app = createApp();

export default {
  fetch: (request: Request, env: RawEnv): Promise<Response> => app.fetch(request, env),
};
