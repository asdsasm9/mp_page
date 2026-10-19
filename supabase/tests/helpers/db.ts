import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
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

/** Applies supabase/migrations/*.sql in filename order. Empty until WP-2. */
export async function applyMigrations(_db: PGlite, files: string[] = []): Promise<void> {
  for (const file of [...files].sort()) {
    await _db.exec(readFileSync(file, 'utf8'));
  }
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
