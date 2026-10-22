import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, createDb, applyMigrations, migrationFiles, seedAdmin } from './helpers/db';
import { functionPrivilegeMatrix, lintPublicSchema, publicFunctions } from './helpers/privileges';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
  // Migration A plus the Google sign-in migration: they must stand on their own.
  const files = migrationFiles();
  await applyMigrations(db, [files[0]!, files.find((f) => f.endsWith('_admin_google_signin.sql'))!]);
  await seedAdmin(db, ADMIN, 'admin@example.test');
  await db.exec(`insert into auth.users (id, email) values ('${OTHER}', 'other@example.test')`);
});

afterAll(async () => {
  await db.close();
});

describe('migration A and the Google sign-in migration: is_admin() and helpers', () => {
  it('is_admin() is true for an admin and false for another user or no user', async () => {
    const q = 'select public.is_admin() as v';
    expect((await asRole(db, 'authenticated', (d) => d.query<{ v: boolean }>(q), ADMIN)).rows[0]!.v).toBe(true);
    expect((await asRole(db, 'authenticated', (d) => d.query<{ v: boolean }>(q), OTHER)).rows[0]!.v).toBe(false);
    expect((await asRole(db, 'authenticated', (d) => d.query<{ v: boolean }>(q))).rows[0]!.v).toBe(false);
  });

  it('anon cannot execute is_admin()', async () => {
    await expect(asRole(db, 'anon', (d) => d.query('select public.is_admin()'))).rejects.toThrow(
      /permission denied for function is_admin/,
    );
  });

  it('is_admin() is security definer with an empty search_path and no PUBLIC or anon execute', async () => {
    const f = (await publicFunctions(db)).find((x) => x.name === 'is_admin');
    expect(f).toMatchObject({
      securityDefiner: true,
      searchPathEmpty: true,
      publicExecute: false,
      anonExecute: false,
      authenticatedExecute: true,
    });
  });

  it('set_updated_at has an empty search_path and is not callable by API roles', async () => {
    const f = (await publicFunctions(db)).find((x) => x.name === 'set_updated_at');
    expect(f).toMatchObject({ searchPathEmpty: true, publicExecute: false, anonExecute: false, authenticatedExecute: false });
  });

  it('function privilege matrix: only is_admin is executable, and only by authenticated', async () => {
    expect(await functionPrivilegeMatrix(db)).toEqual({
      is_admin: { anon: false, authenticated: true },
      set_updated_at: { anon: false, authenticated: false },
    });
  });

  it('the privilege lint reports no violations', async () => {
    expect(await lintPublicSchema(db)).toEqual([]);
  });

  it('the privilege lint does flag a table that was left open', async () => {
    await db.exec(`create table public.oops (id int); `);
    try {
      const findings = await lintPublicSchema(db);
      expect(findings).toEqual(
        expect.arrayContaining([
          'table oops: row level security is not enabled',
          expect.stringContaining('table oops: anon has select'),
        ]),
      );
    } finally {
      await db.exec('drop table public.oops');
    }
  });
});
