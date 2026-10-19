import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, createDb, applyMigrations, migrationFiles } from './helpers/db';
import { functionPrivilegeMatrix, lintPublicSchema, publicFunctions } from './helpers/privileges';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const OTHER_ADMIN = '33333333-3333-3333-3333-333333333333';

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
  // Migration A only: it must stand on its own.
  await applyMigrations(db, migrationFiles().slice(0, 1));
  await db.exec(`
    insert into auth.users (id, email) values
      ('${ADMIN}', 'admin@example.test'), ('${OTHER}', 'other@example.test'),
      ('${OTHER_ADMIN}', 'admin2@example.test');
    insert into public.admins (user_id) values ('${ADMIN}'), ('${OTHER_ADMIN}');
  `);
});

afterAll(async () => {
  await db.close();
});

describe('migration A: admins and is_admin()', () => {
  it('is_admin() is true for an admin', async () => {
    const r = await asRole(db, 'authenticated', (d) => d.query<{ v: boolean }>('select public.is_admin() as v'), ADMIN);
    expect(r.rows[0].v).toBe(true);
  });

  it('is_admin() is false for a user not in admins', async () => {
    const r = await asRole(db, 'authenticated', (d) => d.query<{ v: boolean }>('select public.is_admin() as v'), OTHER);
    expect(r.rows[0].v).toBe(false);
  });

  it('is_admin() is false when there is no user at all', async () => {
    const r = await asRole(db, 'authenticated', (d) => d.query<{ v: boolean }>('select public.is_admin() as v'));
    expect(r.rows[0].v).toBe(false);
  });

  it('anon cannot execute is_admin()', async () => {
    await expect(asRole(db, 'anon', (d) => d.query('select public.is_admin()'))).rejects.toThrow(
      /permission denied for function is_admin/,
    );
  });

  it('anon cannot read admins', async () => {
    await expect(asRole(db, 'anon', (d) => d.query('select * from public.admins'))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('an admin sees only the own row in admins', async () => {
    const r = await asRole(db, 'authenticated', (d) => d.query<{ user_id: string }>('select user_id from public.admins'), ADMIN);
    expect(r.rows).toEqual([{ user_id: ADMIN }]);
  });

  it('a non-admin sees no rows in admins', async () => {
    const r = await asRole(db, 'authenticated', (d) => d.query('select user_id from public.admins'), OTHER);
    expect(r.rows).toEqual([]);
  });

  it('authenticated cannot write admins (no grant)', async () => {
    await expect(
      asRole(db, 'authenticated', (d) => d.query(`insert into public.admins (user_id) values ('${OTHER}')`), ADMIN),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(db, 'authenticated', (d) => d.query(`delete from public.admins where user_id = '${OTHER_ADMIN}'`), ADMIN),
    ).rejects.toThrow(/permission denied/);
  });

  it('deleting the auth user cascades to admins', async () => {
    const tmp = '44444444-4444-4444-4444-444444444444';
    await db.exec(`insert into auth.users (id) values ('${tmp}'); insert into public.admins (user_id) values ('${tmp}');`);
    await db.exec(`delete from auth.users where id = '${tmp}'`);
    const r = await db.query(`select 1 from public.admins where user_id = '${tmp}'`);
    expect(r.rows).toEqual([]);
  });

  it('is_admin() is security definer with an empty search_path and no PUBLIC or anon execute', async () => {
    const fns = await publicFunctions(db);
    const f = fns.find((x) => x.name === 'is_admin');
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
