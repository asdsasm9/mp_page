import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, createMigratedDb, migrationFiles } from './helpers/db';

let db: PGlite;
const asAnon = <T>(fn: (d: PGlite) => Promise<T>) => asRole(db, 'anon', fn);
const asAuth = <T>(fn: (d: PGlite) => Promise<T>) =>
  asRole(db, 'authenticated', fn, '22222222-2222-2222-2222-222222222222');

beforeAll(async () => {
  db = await createMigratedDb();
});

afterAll(async () => {
  await db.close();
});

describe('public.ping()', () => {
  it('returns ok for anon and authenticated', async () => {
    const a = await asAnon((d) => d.query<{ r: string }>('select public.ping() as r'));
    expect(a.rows[0].r).toBe('ok');
    const b = await asAuth((d) => d.query<{ r: string }>('select public.ping() as r'));
    expect(b.rows[0].r).toBe('ok');
  });

  it('is a stable sql function that is not security definer', async () => {
    const r = await db.query<{ lang: string; vol: string; secdef: boolean }>(
      `select l.lanname as lang, p.provolatile as vol, p.prosecdef as secdef
         from pg_proc p join pg_language l on l.oid = p.prolang
        where p.oid = 'public.ping()'::regprocedure`,
    );
    expect(r.rows[0]).toEqual({ lang: 'sql', vol: 's', secdef: false });
  });

  it('the migration touches no table', () => {
    const file = migrationFiles().find((f) => f.endsWith('_ping.sql'));
    expect(file).toBeDefined();
    const sql = readFileSync(file as string, 'utf8').replace(/--.*$/gm, '');
    const body = /\$\$([\s\S]*?)\$\$/.exec(sql)?.[1].trim();
    expect(body).toBe("select 'ok'::text");
  });
});
