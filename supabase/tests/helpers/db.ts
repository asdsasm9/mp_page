import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export type Role = 'anon' | 'authenticated' | 'service_role';

/** Fresh in-memory database with the Supabase auth/role stub applied. */
export async function createDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(here, 'auth-stub.sql'), 'utf8'));
  return db;
}

export const MIGRATIONS_DIR = join(here, '..', '..', 'migrations');

/** Absolute paths of supabase/migrations/*.sql in filename order. */
export function migrationFiles(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(dir, f));
}

/** Applies the given migration files (default: all of supabase/migrations) in filename order. */
export async function applyMigrations(db: PGlite, files: string[] = migrationFiles()): Promise<void> {
  for (const file of [...files].sort()) {
    await db.exec(readFileSync(file, 'utf8'));
  }
}

/** Fresh database with the auth stub and every migration applied. */
export async function createMigratedDb(): Promise<PGlite> {
  const db = await createDb();
  await applyMigrations(db);
  return db;
}

/**
 * Makes `id` an admin the way production does: a confirmed user with a verified Google identity
 * whose e-mail is on public.admin_emails. Creates or updates the user. Use @example.test addresses only.
 */
export async function seedAdmin(db: PGlite, id: string, email: string): Promise<void> {
  const lower = email.trim().toLowerCase();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())
     on conflict (id) do update set email = excluded.email, email_confirmed_at = now()`,
    [id, lower],
  );
  await db.query(
    `insert into auth.identities (user_id, provider, identity_data)
     values ($1, 'google', jsonb_build_object('email', $2::text, 'email_verified', true))`,
    [id, lower],
  );
  await db.query(`insert into public.admin_emails (email) values ($1) on conflict do nothing`, [lower]);
}

/**
 * Runs fn with the session acting as `role` (and, for authenticated, as user `userId`
 * through the request.jwt.claims setting). Always resets afterwards.
 */
export async function asRole<T>(
  db: PGlite,
  role: Role,
  fn: (db: PGlite) => Promise<T>,
  userId?: string,
): Promise<T> {
  const claims = JSON.stringify(userId ? { sub: userId, role } : { role });
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.exec(`set role ${role}`);
  try {
    return await fn(db);
  } finally {
    await db.exec('reset role');
    await db.exec(`reset request.jwt.claims`);
  }
}
