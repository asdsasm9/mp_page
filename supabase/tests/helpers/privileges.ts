import type { PGlite } from '@electric-sql/pglite';

/** Catalog-based privilege matrix and lint helpers (reused by the migration lint, WP2-19). */

export const API_ROLES = ['anon', 'authenticated'] as const;
export type ApiRole = (typeof API_ROLES)[number];
export const TABLE_PRIVS = ['select', 'insert', 'update', 'delete'] as const;
export type TablePriv = (typeof TABLE_PRIVS)[number];

/** 'table' (whole table), 'none', or 'columns:a,b' (column-limited, sorted). */
export type PrivValue = string;
export type TableMatrix = Record<string, Record<ApiRole, Record<TablePriv, PrivValue>>>;
export type FunctionMatrix = Record<string, Record<ApiRole, boolean>>;

async function publicTables(db: PGlite): Promise<string[]> {
  const r = await db.query<{ relname: string }>(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') order by c.relname`,
  );
  return r.rows.map((x) => x.relname);
}

async function tableColumns(db: PGlite, table: string): Promise<string[]> {
  const r = await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns
     where table_schema = 'public' and table_name = $1 order by ordinal_position`,
    [table],
  );
  return r.rows.map((x) => x.column_name);
}

/** Privileges per table, role and command, from has_table_privilege / has_column_privilege. */
export async function tablePrivilegeMatrix(db: PGlite): Promise<TableMatrix> {
  const matrix: TableMatrix = {};
  for (const table of await publicTables(db)) {
    const cols = await tableColumns(db, table);
    matrix[table] = {} as TableMatrix[string];
    for (const role of API_ROLES) {
      const row = {} as Record<TablePriv, PrivValue>;
      for (const priv of TABLE_PRIVS) {
        const whole = await db.query<{ ok: boolean }>(
          `select has_table_privilege($1, format('public.%I', $2::text), $3) as ok`,
          [role, table, priv],
        );
        if (whole.rows[0].ok) {
          row[priv] = 'table';
          continue;
        }
        if (priv === 'delete') {
          row[priv] = 'none';
          continue;
        }
        const granted: string[] = [];
        for (const col of cols) {
          const c = await db.query<{ ok: boolean }>(
            `select has_column_privilege($1, format('public.%I', $2::text), $3, $4) as ok`,
            [role, table, col, priv],
          );
          if (c.rows[0].ok) granted.push(col);
        }
        row[priv] = granted.length ? `columns:${granted.sort().join(',')}` : 'none';
      }
      matrix[table][role] = row;
    }
  }
  return matrix;
}

export interface FunctionInfo {
  signature: string;
  name: string;
  securityDefiner: boolean;
  searchPathEmpty: boolean;
  publicExecute: boolean;
  anonExecute: boolean;
  authenticatedExecute: boolean;
}

/** Every function in schema public that does not belong to an extension. */
export async function publicFunctions(db: PGlite): Promise<FunctionInfo[]> {
  const r = await db.query<{
    signature: string;
    name: string;
    secdef: boolean;
    config: string[] | null;
    public_exec: boolean;
    anon_exec: boolean;
    auth_exec: boolean;
  }>(
    `select p.oid::regprocedure::text as signature,
            p.proname as name,
            p.prosecdef as secdef,
            p.proconfig as config,
            (p.proacl is null or exists (
               select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'
            )) as public_exec,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      order by p.oid::regprocedure::text`,
  );
  return r.rows.map((x) => ({
    signature: x.signature,
    name: x.name,
    securityDefiner: x.secdef,
    searchPathEmpty: (x.config ?? []).some((c) => /^search_path=("")?$/.test(c)),
    publicExecute: x.public_exec,
    anonExecute: x.anon_exec,
    authenticatedExecute: x.auth_exec,
  }));
}

/** Execute privilege per function name (overloads merged with OR) and API role. */
export async function functionPrivilegeMatrix(db: PGlite): Promise<FunctionMatrix> {
  const matrix: FunctionMatrix = {};
  for (const f of await publicFunctions(db)) {
    const cur = matrix[f.name] ?? { anon: false, authenticated: false };
    matrix[f.name] = {
      anon: cur.anon || f.anonExecute,
      authenticated: cur.authenticated || f.authenticatedExecute,
    };
  }
  return matrix;
}

/** Functions anon may execute. */
export const ANON_FUNCTION_ALLOWLIST = ['keepalive'];

/**
 * Catalog lint over the public schema. Returns human-readable findings; empty means clean.
 * Rules (WP-2 section 4): RLS on and a policy for every table, anon holds no table privilege and
 * executes only the allowlisted functions, every security definer function has an empty
 * search_path and no PUBLIC execute.
 */
export async function lintPublicSchema(db: PGlite): Promise<string[]> {
  const findings: string[] = [];

  const tables = await db.query<{ relname: string; rls: boolean; policies: number }>(
    `select c.relname, c.relrowsecurity as rls,
            (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') order by c.relname`,
  );
  for (const t of tables.rows) {
    if (!t.rls) findings.push(`table ${t.relname}: row level security is not enabled`);
    if (t.rls && t.policies === 0) findings.push(`table ${t.relname}: RLS enabled but no policy`);
  }

  const matrix = await tablePrivilegeMatrix(db);
  for (const [table, roles] of Object.entries(matrix)) {
    for (const priv of TABLE_PRIVS) {
      if (roles.anon[priv] !== 'none') findings.push(`table ${table}: anon has ${priv} (${roles.anon[priv]})`);
    }
  }

  for (const f of await publicFunctions(db)) {
    if (f.anonExecute && !ANON_FUNCTION_ALLOWLIST.includes(f.name)) {
      findings.push(`function ${f.signature}: anon can execute`);
    }
    if (f.securityDefiner && !f.searchPathEmpty) {
      findings.push(`function ${f.signature}: security definer without empty search_path`);
    }
    if (f.securityDefiner && f.publicExecute) {
      findings.push(`function ${f.signature}: security definer with PUBLIC execute`);
    }
  }

  return findings;
}
