/**
 * PGlite-backed stand-in for Supabase/PostgREST (WP-4 section 4.8). A `fetch` replacement that
 * serves `POST /rest/v1/rpc/<fn>` and `GET /rest/v1/<table>` on a database built from the real
 * migrations, running every statement under the role the token maps to (so grants, RLS and the
 * quota backstop are the real ones). Test tokens look like `aaaaaaaa.bbbbbbbb.cccc`, never `eyJ`.
 *
 * Supported GET query: `select` (plain column list or `*`), `col=eq.v`, `col=in.(a,b)`, `order`,
 * `limit`, `offset`, and the `Range` header. PostgREST status codes for errors are TO VERIFY live.
 */
import type { PGlite } from '@electric-sql/pglite';
import { asRole, createMigratedDb, seedAdmin, type Role } from '../../../supabase/tests/helpers/db';
import { createApp, type AppDeps } from '../src/index';
import type { FetchFn } from '../src/supabase';
import { goodEnv } from '../src/test-support';

export const SHIM_SUPABASE_URL = 'https://abcdefgh.supabase.co';
export const SHIM_ANON_KEY = 'anon-test-key-value';

export const ADMIN_USER = '11111111-1111-1111-1111-111111111111';
export const OTHER_USER = '22222222-2222-2222-2222-222222222222';

/** What a test token stands for. `expired` and unknown tokens are refused with 401. */
export type TokenInfo = { userId: string } | { expired: true };

export interface ShimOptions {
  db: PGlite;
  tokens: ReadonlyMap<string, TokenInfo>;
  supabaseUrl?: string;
  anonKey?: string;
}

export interface Shim {
  fetch: FetchFn;
  /** Every request seen: method, path (with query) and the role it ran as (null when refused early). */
  calls: { method: string; path: string; role: Role | null }[];
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const COLUMN_LIST = /^(\*|[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*)$/;
const RESERVED_PARAMS = new Set(['select', 'order', 'limit', 'offset']);

interface PgError {
  code?: string;
  message?: string;
  detail?: string;
  hint?: string;
}

const jsonBody = (value: unknown) =>
  JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? Number(v) : v));

const respond = (status: number, body: unknown) =>
  new Response(body === undefined ? null : jsonBody(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Maps a database error to the PostgREST shape and status (raise exception -> 400, 42501 -> 401/403). */
function pgErrorResponse(e: unknown, role: Role): Response {
  const err = e as PgError;
  const code = typeof err.code === 'string' ? err.code : 'XX000';
  const body = { code, message: err.message ?? 'error', details: err.detail ?? null, hint: err.hint ?? null };
  if (code === '42501') return respond(role === 'anon' ? 401 : 403, body);
  if (code.startsWith('23')) return respond(409, body);
  if (code === '42883' || code === '42P01') return respond(404, body);
  return respond(400, body);
}

/** A JS value as a text parameter for `$n::<type>`. Arrays become Postgres array literals. */
function paramValue(value: unknown, type: string): string | null {
  if (value === null || value === undefined) return null;
  if (type === 'jsonb' || type === 'json') return JSON.stringify(value);
  if (Array.isArray(value)) {
    const items = value.map((v) => (v === null ? 'NULL' : `"${String(v).replace(/(["\\])/g, '\\$1')}"`));
    return `{${items.join(',')}}`;
  }
  return String(value);
}

interface FnInfo {
  proretset: boolean;
  typtype: string;
  ret: string;
  argnames: string[] | null;
  argtypes: string[];
}

export function createSupabaseShim(options: ShimOptions): Shim {
  const { db, tokens } = options;
  const base = (options.supabaseUrl ?? SHIM_SUPABASE_URL).replace(/\/+$/, '');
  const anonKey = options.anonKey ?? SHIM_ANON_KEY;
  const calls: Shim['calls'] = [];

  // PGlite is a single session and `set role` is session state: run one request at a time.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const run = <T>(role: Role, userId: string | undefined, fn: (d: PGlite) => Promise<T>) =>
    asRole(db, role, fn, userId);

  async function rpc(name: string, request: Request, role: Role, userId: string | undefined): Promise<Response> {
    if (!IDENT.test(name)) return respond(404, { code: 'PGRST202', message: 'function not found' });
    let args: Record<string, unknown> = {};
    const text = await request.text();
    if (text !== '') {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
        args = parsed as Record<string, unknown>;
      } catch {
        return respond(400, { code: 'PGRST102', message: 'Empty or invalid json' });
      }
    }
    const info = (
      await db.query<FnInfo>(
        `select p.proretset, t.typtype, p.prorettype::regtype::text as ret, p.proargnames as argnames,
                coalesce((select array_agg(format_type(a, null) order by ord)
                            from unnest(p.proargtypes::oid[]) with ordinality u(a, ord)), '{}') as argtypes
           from pg_proc p join pg_type t on t.oid = p.prorettype
          where p.pronamespace = 'public'::regnamespace and p.proname = $1
          limit 1`,
        [name],
      )
    ).rows[0];
    if (!info) return respond(404, { code: 'PGRST202', message: 'function not found' });

    const names = info.argnames ?? [];
    const params: (string | null)[] = [];
    const assigns: string[] = [];
    for (const [key, value] of Object.entries(args)) {
      const i = names.indexOf(key);
      if (!IDENT.test(key) || i < 0) return respond(404, { code: 'PGRST202', message: 'unknown argument' });
      const type = info.argtypes[i]!;
      params.push(paramValue(value, type));
      assigns.push(`"${key}" => $${params.length}::${type}`);
    }

    try {
      const res = await run(role, userId, (d) =>
        d.query<Record<string, unknown>>(`select * from public."${name}"(${assigns.join(', ')})`, params),
      );
      if (info.ret === 'void') return new Response(null, { status: 204 });
      if (info.proretset) return respond(200, res.rows);
      const row = res.rows[0];
      if (info.typtype === 'c') return respond(200, row ?? null);
      return respond(200, row ? row[name] : null);
    } catch (e) {
      return pgErrorResponse(e, role);
    }
  }

  async function select(table: string, url: URL, request: Request, role: Role, userId: string | undefined) {
    if (!IDENT.test(table)) return respond(404, { code: '42P01', message: 'relation not found' });
    const cols = url.searchParams.get('select') ?? '*';
    if (!COLUMN_LIST.test(cols)) return respond(400, { code: 'PGRST100', message: 'unsupported select' });
    const colSql = cols === '*' ? '*' : cols.split(',').map((c) => `"${c}"`).join(', ');

    const params: (string | string[])[] = [];
    const where: string[] = [];
    for (const [key, value] of url.searchParams) {
      if (RESERVED_PARAMS.has(key)) continue;
      if (!IDENT.test(key)) return respond(400, { code: 'PGRST100', message: 'bad filter column' });
      if (value.startsWith('eq.')) {
        params.push(value.slice(3));
        where.push(`"${key}"::text = $${params.length}`);
      } else if (value.startsWith('in.(') && value.endsWith(')')) {
        const list = value.slice(4, -1);
        params.push(list === '' ? [] : list.split(',').map((v) => v.replace(/^"|"$/g, '')));
        where.push(`"${key}"::text = any($${params.length}::text[])`);
      } else {
        return respond(400, { code: 'PGRST100', message: 'unsupported filter' });
      }
    }

    let orderSql = '';
    const order = url.searchParams.get('order');
    if (order !== null) {
      const parts: string[] = [];
      for (const term of order.split(',')) {
        const m = /^([a-z_][a-z0-9_]*)(?:\.(asc|desc))?$/.exec(term);
        if (!m) return respond(400, { code: 'PGRST100', message: 'bad order' });
        parts.push(`"${m[1]}" ${m[2] ?? 'asc'}`);
      }
      orderSql = ` order by ${parts.join(', ')}`;
    }

    let limit: number | null = null;
    let offset = 0;
    const range = /^(\d+)-(\d+)$/.exec(request.headers.get('range') ?? '');
    if (range) {
      offset = Number(range[1]);
      limit = Number(range[2]) - offset + 1;
    }
    const qLimit = url.searchParams.get('limit');
    if (qLimit !== null && /^\d+$/.test(qLimit)) limit = limit === null ? Number(qLimit) : Math.min(limit, Number(qLimit));
    const qOffset = url.searchParams.get('offset');
    if (qOffset !== null && /^\d+$/.test(qOffset)) offset += Number(qOffset);

    const sql =
      `select ${colSql} from public."${table}"` +
      (where.length > 0 ? ` where ${where.join(' and ')}` : '') +
      orderSql +
      (limit !== null ? ` limit ${limit}` : '') +
      (offset > 0 ? ` offset ${offset}` : '');
    try {
      const res = await run(role, userId, (d) => d.query(sql, params));
      return respond(200, res.rows);
    } catch (e) {
      return pgErrorResponse(e, role);
    }
  }

  const shimFetch: FetchFn = (input, init) =>
    serial(async () => {
      const request = new Request(input as Request | string, init);
      const url = new URL(request.url);
      const path = `${url.pathname}${url.search}`;
      const record = (role: Role | null) => calls.push({ method: request.method, path, role });

      if (!request.url.startsWith(`${base}/rest/v1/`)) {
        record(null);
        return respond(404, { message: 'not found' });
      }
      if (request.headers.get('apikey') !== anonKey) {
        record(null);
        return respond(401, { message: 'Invalid API key' });
      }

      const auth = request.headers.get('authorization');
      const bearer = auth === null ? anonKey : /^Bearer (\S+)$/i.exec(auth)?.[1];
      let role: Role;
      let userId: string | undefined;
      if (bearer === anonKey) {
        role = 'anon';
      } else {
        const info = bearer === undefined ? undefined : tokens.get(bearer);
        if (!info || 'expired' in info) {
          record(null);
          return respond(401, { code: 'PGRST301', message: 'JWT invalid' });
        }
        role = 'authenticated';
        userId = info.userId;
      }
      record(role);

      const rest = url.pathname.slice('/rest/v1/'.length);
      if (request.method === 'POST' && rest.startsWith('rpc/')) return rpc(rest.slice(4), request, role, userId);
      if (request.method === 'GET' && !rest.includes('/')) return select(rest, url, request, role, userId);
      return respond(404, { message: 'not found' });
    });

  return { fetch: shimFetch, calls };
}

export const ADMIN_TOKEN = 'aaaaaaaa.bbbbbbbb.admn';
export const NON_ADMIN_TOKEN = 'aaaaaaaa.bbbbbbbb.user';
export const EXPIRED_TOKEN = 'aaaaaaaa.bbbbbbbb.oldd';

export interface World {
  app: ReturnType<typeof createApp>;
  db: PGlite;
  shim: Shim;
  /** Worker bindings that match the shim (`goodEnv`). */
  env: Record<string, string>;
  tokens: { admin: string; nonAdmin: string; expired: string };
  /**
   * Creates a user with a bearer token. `google` gives it a verified Google identity, `onList` puts
   * its e-mail on admin_emails; without `google` it only has an `email` identity. Returns the token.
   */
  addUser(user: { id: string; email: string; token: string; google: boolean; onList: boolean }): Promise<string>;
  close(): Promise<void>;
}

export interface WorldOptions {
  /** Extra Worker dependencies (routes, storage, ...). `fetch` is always the shim. */
  deps?: Omit<AppDeps, 'fetch'>;
}

/** Migrated database with an admin and a non-admin user, the shim, and a Worker app wired to it. */
export async function makeWorld(options: WorldOptions = {}): Promise<World> {
  const db = await createMigratedDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${OTHER_USER}', 'other@example.test');
  `);
  await seedAdmin(db, ADMIN_USER, 'admin@example.test');
  const tokens = new Map<string, TokenInfo>([
    [ADMIN_TOKEN, { userId: ADMIN_USER }],
    [NON_ADMIN_TOKEN, { userId: OTHER_USER }],
    [EXPIRED_TOKEN, { expired: true }],
  ]);
  const shim = createSupabaseShim({ db, tokens });
  const app = createApp({ ...options.deps, fetch: shim.fetch });
  return {
    app,
    db,
    shim,
    env: goodEnv(),
    tokens: { admin: ADMIN_TOKEN, nonAdmin: NON_ADMIN_TOKEN, expired: EXPIRED_TOKEN },
    async addUser({ id, email, token, google, onList }) {
      const lower = email.trim().toLowerCase();
      if (google) {
        await seedAdmin(db, id, lower);
        if (!onList) await db.query(`delete from public.admin_emails where email = $1`, [lower]);
      } else {
        await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, lower]);
        await db.query(
          `insert into auth.identities (user_id, provider, identity_data)
           values ($1, 'email', jsonb_build_object('email', $2::text, 'email_verified', true))`,
          [id, lower],
        );
        if (onList) await db.query(`insert into public.admin_emails (email) values ($1) on conflict do nothing`, [lower]);
      }
      tokens.set(token, { userId: id });
      return token;
    },
    close: () => db.close(),
  };
}
