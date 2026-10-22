import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, createDb } from './helpers/db';

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
  await db.exec(`
    insert into auth.users (id, email) values
      ('${USER_A}', 'a@example.test'), ('${USER_B}', 'b@example.test');

    create table public.notes (id int primary key, owner uuid not null, body text, secret text);
    insert into public.notes values (1, '${USER_A}', 'a1', 's1'), (2, '${USER_B}', 'b1', 's2');
    alter table public.notes enable row level security;
    create policy notes_own on public.notes for select to authenticated
      using (owner = (select auth.uid()));

    -- column-level grant: authenticated may select only id and body
    revoke all on public.notes from anon, authenticated;
    grant select (id, body) on public.notes to authenticated;
    -- policy-bound table needs select on owner for the policy expression? (policy reads owner as table owner context)
    grant select (owner) on public.notes to authenticated;

    create function public.definer_probe() returns text
      language sql security definer set search_path = ''
      as $$ select 'ran:' || (select count(*)::text from public.notes) $$;

    create function public.locked_fn() returns int language sql as $$ select 1 $$;
    revoke execute on function public.locked_fn() from public, anon;
  `);
});

afterAll(async () => {
  await db.close();
});

describe('PGlite capability spike', () => {
  it('SET ROLE works and reports the role', async () => {
    const r = await asRole(db, 'authenticated', async (d) => d.query<{ u: string }>('select current_user as u'));
    expect(r.rows[0].u).toBe('authenticated');
    const back = await db.query<{ u: string }>('select current_user as u');
    expect(back.rows[0].u).not.toBe('authenticated');
  });

  it('RLS policy hides other users rows from a role', async () => {
    const own = await asRole(db, 'authenticated', (d) => d.query('select id from public.notes order by id'), USER_A);
    expect(own.rows).toEqual([{ id: 1 }]);
    const other = await asRole(db, 'authenticated', (d) => d.query('select id from public.notes order by id'), USER_B);
    expect(other.rows).toEqual([{ id: 2 }]);
  });

  it('RLS gives no rows to a user who owns none', async () => {
    const r = await asRole(
      db,
      'authenticated',
      (d) => d.query('select id from public.notes'),
      '33333333-3333-3333-3333-333333333333',
    );
    expect(r.rows).toEqual([]);
  });

  it('table privilege denies anon outright', async () => {
    await expect(asRole(db, 'anon', (d) => d.query('select id from public.notes'))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('column-level grant: granted columns readable, others denied', async () => {
    const ok = await asRole(db, 'authenticated', (d) => d.query('select body from public.notes'), USER_A);
    expect(ok.rows).toEqual([{ body: 'a1' }]);
    await expect(
      asRole(db, 'authenticated', (d) => d.query('select secret from public.notes'), USER_A),
    ).rejects.toThrow(/permission denied/);
  });

  it('security definer function with empty search_path runs, bypassing RLS and table grants', async () => {
    const r = await asRole(db, 'authenticated', (d) => d.query<{ definer_probe: string }>('select public.definer_probe()'), USER_A);
    expect(r.rows[0].definer_probe).toBe('ran:2');
  });

  it('revoke execute from public and anon is honoured', async () => {
    await expect(asRole(db, 'anon', (d) => d.query('select public.locked_fn()'))).rejects.toThrow(
      /permission denied for function/,
    );
    const r = await asRole(db, 'authenticated', (d) => d.query('select public.locked_fn() as v'), USER_A);
    expect(r.rows[0]).toEqual({ v: 1 });
  });

  it('default privileges are permissive: a new function is executable by anon until revoked', async () => {
    await db.exec(`create function public.open_fn() returns int language sql as $$ select 2 $$;`);
    const r = await asRole(db, 'anon', (d) => d.query('select public.open_fn() as v'));
    expect(r.rows[0]).toEqual({ v: 2 });
  });

  it('auth.uid() follows the claim (request.jwt.claims)', async () => {
    const a = await asRole(db, 'authenticated', (d) => d.query<{ u: string | null }>('select auth.uid() as u'), USER_A);
    expect(a.rows[0].u).toBe(USER_A);
    const anon = await asRole(db, 'anon', (d) => d.query<{ u: string | null }>('select auth.uid() as u'));
    expect(anon.rows[0].u).toBeNull();
  });

  it('auth.uid() also honours the legacy request.jwt.claim.sub setting', async () => {
    await db.exec(`select set_config('request.jwt.claim.sub', '${USER_B}', false)`);
    try {
      const r = await db.query<{ u: string }>('select auth.uid() as u');
      expect(r.rows[0].u).toBe(USER_B);
    } finally {
      await db.exec(`reset request.jwt.claim.sub`);
    }
  });
});
