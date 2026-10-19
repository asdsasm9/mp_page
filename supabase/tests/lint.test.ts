import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_COLUMNS } from '../../packages/shared/src/db';
import { createMigratedDb, migrationFiles } from './helpers/db';
import { lintMigrationText } from './helpers/migration-text';
import {
  functionPrivilegeMatrix,
  lintPublicSchema,
  publicFunctions,
  tablePrivilegeMatrix,
} from './helpers/privileges';

const here = dirname(fileURLToPath(import.meta.url));
export const GOLDEN_PATH = join(here, 'golden', 'privilege-matrix.json');

const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as {
  tables: unknown;
  functions: unknown;
};

// A migration that breaks every rule on purpose; it is only ever applied to a scratch database.
const BAD_MIGRATION = `
create table public.leaky (id uuid primary key, secret text);
grant select, insert on table public.leaky to anon;
create table public.no_policy (id uuid primary key);
alter table public.no_policy enable row level security;
create function public.sneaky() returns integer
language sql security definer
as $$ select 1 $$;
`;

let db: PGlite;

beforeAll(async () => {
  db = await createMigratedDb();
});

afterAll(async () => {
  await db.close();
});

describe('catalog lint over the public schema', () => {
  it('reports no findings after all migrations', async () => {
    expect(await lintPublicSchema(db)).toEqual([]);
  });

  it('every table has RLS on and at least one policy', async () => {
    const r = await db.query<{ relname: string; rls: boolean; policies: number }>(
      `select c.relname, c.relrowsecurity as rls,
              (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p')`,
    );
    expect(r.rows.length).toBe(Object.keys(DB_COLUMNS).length);
    for (const t of r.rows) {
      expect(t.rls, `${t.relname} RLS`).toBe(true);
      expect(t.policies, `${t.relname} policies`).toBeGreaterThan(0);
    }
  });

  it('anon holds no table privilege and executes only keepalive', async () => {
    const tables = await tablePrivilegeMatrix(db);
    for (const [t, roles] of Object.entries(tables)) {
      expect(roles.anon, `anon on ${t}`).toEqual({ select: 'none', insert: 'none', update: 'none', delete: 'none' });
    }
    const anonFns = (await publicFunctions(db)).filter((f) => f.anonExecute).map((f) => f.name);
    expect(anonFns).toEqual(['keepalive']);
  });

  it('every security definer function has an empty search_path and no PUBLIC execute', async () => {
    const defs = (await publicFunctions(db)).filter((f) => f.securityDefiner);
    expect(defs.length).toBeGreaterThanOrEqual(10);
    for (const f of defs) {
      expect(f.searchPathEmpty, `${f.signature} search_path`).toBe(true);
      expect(f.publicExecute, `${f.signature} PUBLIC execute`).toBe(false);
    }
  });

  it('no function in public has PUBLIC execute, security definer or not', async () => {
    for (const f of await publicFunctions(db)) {
      expect(f.publicExecute, `${f.signature} PUBLIC execute`).toBe(false);
    }
  });

  it('the privilege matrix equals the committed golden file', async () => {
    expect(await tablePrivilegeMatrix(db)).toEqual(golden.tables);
    expect(await functionPrivilegeMatrix(db)).toEqual(golden.functions);
  });
});

describe('DB_COLUMNS drift', () => {
  it('shared DB_COLUMNS equals information_schema for every public table, and covers all of them', async () => {
    const t = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
    );
    expect(t.rows.map((r) => r.table_name)).toEqual(Object.keys(DB_COLUMNS).sort());
    for (const [table, cols] of Object.entries(DB_COLUMNS)) {
      const r = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = $1 order by ordinal_position`,
        [table],
      );
      expect(r.rows.map((x) => x.column_name), table).toEqual([...cols]);
    }
  });
});

describe('migration text', () => {
  const files = migrationFiles();

  it('migrations exist and are named in strictly ascending order', () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
    const names = files.map((f) => basename(f));
    for (const n of names) expect(n).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(names).toEqual([...names].sort());
    expect(new Set(names.map((n) => n.slice(0, 14))).size).toBe(names.length);
  });

  for (const file of files) {
    it(`${basename(file)} has no "to public", "using (true)" or service_role`, () => {
      expect(lintMigrationText(basename(file), readFileSync(file, 'utf8'))).toEqual([]);
    });
  }

  it('the text lint finds each forbidden pattern (negative cases)', () => {
    const bad = (sql: string) => lintMigrationText('bad.sql', sql);
    expect(bad('grant select on public.x to public;')).not.toEqual([]);
    expect(bad('grant select on public.x to anon, public;')).not.toEqual([]);
    expect(bad('create policy p on public.x for select using (true);')).not.toEqual([]);
    expect(bad('create policy p on public.x for select using ( TRUE );')).not.toEqual([]);
    expect(bad('grant all on public.x to service_role;')).not.toEqual([]);
  });

  it('the text lint ignores comments and schema prefixes', () => {
    expect(lintMigrationText('ok.sql', '-- grant to public using (true) service_role\ninsert into public.x values (1);')).toEqual([]);
    expect(lintMigrationText('ok.sql', 'grant select on public.x to authenticated;\nrevoke execute on function public.f() from public, anon;')).toEqual([]);
  });
});

describe('negative test: a bad migration is caught', () => {
  it('lint findings, matrix difference and text findings on a scratch database', async () => {
    const scratch = await createMigratedDb();
    try {
      await scratch.exec(BAD_MIGRATION);
      const findings = await lintPublicSchema(scratch);
      expect(findings.join('\n')).toMatch(/table leaky: row level security is not enabled/);
      expect(findings.join('\n')).toMatch(/table leaky: anon has select/);
      expect(findings.join('\n')).toMatch(/table no_policy: RLS enabled but no policy/);
      expect(findings.join('\n')).toMatch(/sneaky\(\): security definer without empty search_path/);
      expect(findings.join('\n')).toMatch(/sneaky\(\): anon can execute/);
      expect(findings.join('\n')).toMatch(/sneaky\(\): security definer with PUBLIC execute/);

      expect(await tablePrivilegeMatrix(scratch)).not.toEqual(golden.tables);
      expect(await functionPrivilegeMatrix(scratch)).not.toEqual(golden.functions);
      const cols = await scratch.query(`select 1 from information_schema.tables where table_name = 'leaky'`);
      expect(cols.rows.length).toBe(1);
    } finally {
      await scratch.close();
    }
    expect(lintMigrationText('bad.sql', `${BAD_MIGRATION}\ngrant select on public.leaky to public;`)).not.toEqual([]);
  });
});
