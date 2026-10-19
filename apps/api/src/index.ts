import { authenticate } from './auth';
import { createSupabaseClient, type FetchFn, type SupabaseClient } from './supabase';
import { applyCors, checkOrigin, deniedOriginResponse, preflightResponse } from './cors';
import { parseEnv, type Config, type EnvOptions, type RawEnv } from './env';
import { errorResponse, jsonResponse, withBaseHeaders, withRequestId } from './http';
import { createLogger, errorName, newRequestId, type Logger } from './logger';
import { DEFAULT_ROUTES } from './default-routes';
import { BINDING_NAMES, missingBindings, storagesFromEnv, type Storages } from './storage/bindings';
import { createScheduled } from './keepalive';

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
  /** Extra routes by exact path; they take precedence over the default table. */
  routes?: Record<string, Route>;
  env?: EnvOptions;
  /** Injected fetch for Supabase calls (default: global fetch). */
  fetch?: FetchFn;
  /** Storage for the default routes (default: built from the `PHOTOS` and `BACKUP` R2 bindings). */
  storage?: (rawEnv: RawEnv | undefined, config: Config) => Storages | null;
}

const healthRoute: Route = { methods: ['GET'], auth: false, handler: () => jsonResponse({ ok: true }, 200) };

/**
 * Request pipeline: request id, env check, CORS (disallowed Origin 403, preflight 204 before auth),
 * routing (404, 405 with Allow), auth, handler. Every response gets no-store, nosniff, Vary: Origin
 * and `x-request-id`. Unexpected exceptions become `{error:'INTERNAL'}`; the log keeps only the
 * request id and the error name, never the message.
 */
export function createApp(deps: AppDeps = {}) {
  const extraRoutes: Record<string, Route> = deps.routes ?? {};
  const getStorages = deps.storage ?? storagesFromEnv;

  async function process(request: Request, rawEnv: RawEnv | undefined, log: Logger): Promise<Response> {
    const parsed = parseEnv(rawEnv, deps.env);
    if (!parsed.ok) {
      // Names only, never values.
      log.error('CONFIG_ERROR', { invalid: parsed.invalid });
      return errorResponse('CONFIG_ERROR');
    }
    const { config } = parsed;

    const origin = checkOrigin(request, config.allowedOrigins);
    if (origin.kind === 'denied') return deniedOriginResponse();
    if (request.method === 'OPTIONS') return preflightResponse(origin);

    const { pathname } = new URL(request.url);
    let route: Route | undefined;
    if (pathname === '/health') route = healthRoute;
    else if (Object.hasOwn(extraRoutes, pathname)) route = extraRoutes[pathname];
    else if (Object.hasOwn(DEFAULT_ROUTES, pathname)) {
      const storages = getStorages(rawEnv, config);
      if (!storages) {
        log.error('CONFIG_ERROR', { invalid: deps.storage ? [...BINDING_NAMES] : missingBindings(rawEnv) });
        return applyCors(errorResponse('CONFIG_ERROR'), origin);
      }
      route = DEFAULT_ROUTES[pathname]!(storages);
    }
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
    } catch (e) {
      // No message in the body or the log: errors may carry tokens, URLs or input.
      log.error('INTERNAL', { errorName: errorName(e), path: pathname, method: request.method });
      response = errorResponse('INTERNAL');
    }
    return applyCors(withBaseHeaders(response), origin);
  }

  async function handle(request: Request, rawEnv: RawEnv | undefined): Promise<Response> {
    const requestId = newRequestId();
    const log = createLogger(requestId);
    let response: Response;
    try {
      response = await process(request, rawEnv, log);
    } catch (e) {
      log.error('INTERNAL', { errorName: errorName(e) });
      response = withBaseHeaders(errorResponse('INTERNAL'));
    }
    let path = '';
    try {
      path = new URL(request.url).pathname;
    } catch {
      /* unparsable URL: leave the path empty */
    }
    log.info('request', { method: request.method, path, status: response.status });
    return withRequestId(response, requestId);
  }

  return { fetch: handle };
}

const app = createApp();

export default {
  fetch: (request: Request, env: RawEnv): Promise<Response> => app.fetch(request, env),
  scheduled: createScheduled(),
};
