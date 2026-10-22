import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, createMigratedDb, seedAdmin } from './helpers/db';
import { lintPublicSchema, tablePrivilegeMatrix } from './helpers/privileges';

// Only @example.test addresses. Ids are fixed so failures are readable.
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LISTED = U(1);
const UPPER = U(2);
const EMAIL_ONLY = U(3);
const UNVERIFIED = U(4);
const UNLISTED = U(5);
const UNCONFIRMED = U(6);
const BANNED = U(7);
const DELETED = U(8);
const MISMATCH = U(9);
const EXPIRED_BAN = U(10);
const NOBODY = U(99);

let db: PGlite;

const isAdmin = async (userId?: string): Promise<boolean> =>
  (await asRole(db, 'authenticated', (d) => d.query<{ v: boolean }>('select public.is_admin() as v'), userId)).rows[0]!.v;

async function addUser(id: string, email: string, extra = ''): Promise<void> {
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, email]);
  if (extra) await db.exec(extra);
}

async function addGoogle(id: string, identityEmail: string, verified: boolean | string = true): Promise<void> {
  await db.query(
    `insert into auth.identities (user_id, provider, identity_data)
     values ($1, 'google', jsonb_build_object('email', $2::text, 'email_verified', $3::jsonb))`,
    [id, identityEmail, JSON.stringify(verified)],
  );
}

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into public.admin_emails (email) values
    ('upper@example.test'), ('emailonly@example.test'), ('unverified@example.test'), ('unconfirmed@example.test'),
    ('banned@example.test'), ('deleted@example.test'), ('mismatch@example.test'), ('expiredban@example.test')`);

  await seedAdmin(db, LISTED, 'listed@example.test');

  await addUser(UPPER, 'upper@example.test');
  await addGoogle(UPPER, 'UPPER@Example.Test');

  await addUser(EMAIL_ONLY, 'emailonly@example.test');
  await db.query(
    `insert into auth.identities (user_id, provider, identity_data)
     values ($1, 'email', '{"email":"emailonly@example.test","email_verified":true}')`,
    [EMAIL_ONLY],
  );

  await addUser(UNVERIFIED, 'unverified@example.test');
  await addGoogle(UNVERIFIED, 'unverified@example.test', false);

  await addUser(UNLISTED, 'stranger@example.test');
  await addGoogle(UNLISTED, 'stranger@example.test');

  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, 'unconfirmed@example.test', null)`, [UNCONFIRMED]);
  await addGoogle(UNCONFIRMED, 'unconfirmed@example.test');

  await addUser(BANNED, 'banned@example.test');
  await db.query(`update auth.users set banned_until = now() + interval '1 day' where id = $1`, [BANNED]);
  await addGoogle(BANNED, 'banned@example.test');

  await addUser(DELETED, 'deleted@example.test');
  await db.query(`update auth.users set deleted_at = now() where id = $1`, [DELETED]);
  await addGoogle(DELETED, 'deleted@example.test');

  await addUser(MISMATCH, 'mismatch-user@example.test');
  await addGoogle(MISMATCH, 'mismatch@example.test');

  await addUser(EXPIRED_BAN, 'expiredban@example.test');
  await db.query(`update auth.users set banned_until = now() - interval '1 day' where id = $1`, [EXPIRED_BAN]);
  await addGoogle(EXPIRED_BAN, 'expiredban@example.test');
});

afterAll(async () => {
  await db.close();
});

describe('is_admin() with the Google identity rule', () => {
  it('is true for an allow-listed verified Google identity', async () => {
    expect(await isAdmin(LISTED)).toBe(true);
  });

  it('matches the identity e-mail case-insensitively', async () => {
    expect(await isAdmin(UPPER)).toBe(true);
  });

  it('is false when the e-mail is listed but the only identity is the e-mail provider', async () => {
    expect(await isAdmin(EMAIL_ONLY)).toBe(false);
  });

  it('is false when the Google e-mail is not verified', async () => {
    expect(await isAdmin(UNVERIFIED)).toBe(false);
  });

  it('is false for a Google user that is not on the list', async () => {
    expect(await isAdmin(UNLISTED)).toBe(false);
  });

  it('is false for an unconfirmed, a banned and a deleted user', async () => {
    expect(await isAdmin(UNCONFIRMED)).toBe(false);
    expect(await isAdmin(BANNED)).toBe(false);
    expect(await isAdmin(DELETED)).toBe(false);
  });

  it('is true again once a ban has expired', async () => {
    expect(await isAdmin(EXPIRED_BAN)).toBe(true);
  });

  it('is false when there is no user, or an unknown user id', async () => {
    expect(await isAdmin()).toBe(false);
    expect(await isAdmin(NOBODY)).toBe(false);
  });

  it('is false when the identity e-mail differs from the user e-mail', async () => {
    expect(await isAdmin(MISMATCH)).toBe(false);
  });

  it('follows the list at once: removing the address revokes, adding it grants', async () => {
    await db.exec(`delete from public.admin_emails where email = 'listed@example.test'`);
    expect(await isAdmin(LISTED)).toBe(false);
    await db.exec(`insert into public.admin_emails (email) values ('listed@example.test')`);
    expect(await isAdmin(LISTED)).toBe(true);
  });

  it('anon cannot execute is_admin()', async () => {
    await expect(asRole(db, 'anon', (d) => d.query('select public.is_admin()'))).rejects.toThrow(
      /permission denied for function is_admin/,
    );
  });
});

describe('public.admin_emails', () => {
  it('refuses un-normalized addresses', async () => {
    await expect(db.exec(`insert into public.admin_emails (email) values ('Mixed@Example.Test')`)).rejects.toThrow(
      /admin_emails_normalized/,
    );
    await expect(db.exec(`insert into public.admin_emails (email) values (' pad@example.test')`)).rejects.toThrow(
      /admin_emails_normalized/,
    );
    await expect(db.exec(`insert into public.admin_emails (email) values ('nodomain')`)).rejects.toThrow(
      /admin_emails_normalized/,
    );
  });

  it('is not readable or writable by anon or authenticated', async () => {
    await expect(asRole(db, 'anon', (d) => d.query('select * from public.admin_emails'))).rejects.toThrow(/permission denied/);
    for (const sql of [
      'select * from public.admin_emails',
      `insert into public.admin_emails (email) values ('new@example.test')`,
      `update public.admin_emails set email = 'x@example.test'`,
      'delete from public.admin_emails',
    ]) {
      await expect(asRole(db, 'authenticated', (d) => d.query(sql), LISTED), sql).rejects.toThrow(/permission denied/);
    }
  });

  it('has RLS on and no grant to any API role in the privilege matrix', async () => {
    const matrix = await tablePrivilegeMatrix(db);
    const none = { select: 'none', insert: 'none', update: 'none', delete: 'none' };
    expect(matrix.admin_emails).toEqual({ anon: none, authenticated: none });
    const r = await db.query<{ rls: boolean }>(
      `select relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'admin_emails'`,
    );
    expect(r.rows[0]!.rls).toBe(true);
  });

  it('keeps the privilege lint clean', async () => {
    expect(await lintPublicSchema(db)).toEqual([]);
  });

  it('replaces the old admins table (it is gone)', async () => {
    const r = await db.query(
      `select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'admins'`,
    );
    expect(r.rows).toEqual([]);
  });
});

describe('a non-listed Google user is denied everywhere', () => {
  it('a catalog policy hides and refuses the write', async () => {
    const rows = await asRole(db, 'authenticated', (d) => d.query('select * from public.categories'), UNLISTED);
    expect(rows.rows).toEqual([]);
    await expect(
      asRole(
        db,
        'authenticated',
        (d) => d.query(`insert into public.categories (slug, name) values ('svatby', 'Svatby')`),
        UNLISTED,
      ),
    ).rejects.toThrow(/row-level security|permission denied/);
  });

  it('an RPC raises NOT_ADMIN, while the listed admin passes', async () => {
    await expect(
      asRole(db, 'authenticated', (d) => d.query('select public.storage_usage()'), UNLISTED),
    ).rejects.toThrow(/NOT_ADMIN/);
    const ok = await asRole(db, 'authenticated', (d) => d.query('select public.storage_usage() as u'), LISTED);
    expect(ok.rows).toHaveLength(1);
  });
});
