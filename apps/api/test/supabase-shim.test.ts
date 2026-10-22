import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole } from '../../../supabase/tests/helpers/db';
import { sumBytes, type PhotoVariants } from '../../../packages/shared/src/variants';
import { createSupabaseClient } from '../src/supabase';
import { goodEnv } from '../src/test-support';
import { ADMIN_USER, SHIM_ANON_KEY, SHIM_SUPABASE_URL, makeWorld, type World } from './supabase-shim';

const CAT = 'aaaaaaaa-0000-4000-8000-000000000001';
const ALB = 'bbbbbbbb-0000-4000-8000-000000000001';
const PHOTO = 'cccccccc-0000-4000-8000-000000000001';
const PHOTO2 = 'cccccccc-0000-4000-8000-000000000002';
const VARIANTS: PhotoVariants = {
  master: { w: 3000, h: 2000, bytes: 1_000_000 },
  webp: [{ tier: 480, w: 480, h: 320, bytes: 30_000 }],
  jpeg: { w: 1600, h: 1067, bytes: 300_000 },
  og: { w: 1200, h: 630, bytes: 120_000 },
};

let world: World;
let client: ReturnType<typeof createSupabaseClient>;

beforeAll(async () => {
  world = await makeWorld();
  client = createSupabaseClient({ supabaseUrl: SHIM_SUPABASE_URL, anonKey: SHIM_ANON_KEY, fetch: world.shim.fetch });
  await world.db.exec(`
    insert into public.categories (id, slug, name) values ('${CAT}', 'svatby', 'Svatby');
    insert into public.albums (id, category_id, slug, title) values ('${ALB}', '${CAT}', 'one', 'One');
    insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total)
    values ('${PHOTO}', '${ALB}', 'photos/${PHOTO}/master.jpg', 3000, 2000, '{}', 12345);
  `);
});

afterAll(async () => {
  await world.close();
});

describe('supabase shim', () => {
  it('is_admin is true for the admin token and false for a non-admin', async () => {
    expect(await client.rpc('is_admin', {}, world.tokens.admin)).toEqual({ ok: true, data: true });
    expect(await client.rpc('is_admin', {}, world.tokens.nonAdmin)).toEqual({ ok: true, data: false });
  });

  it('refuses an unknown token, an expired token and a wrong apikey with 401', async () => {
    const unknown = await client.rpc('is_admin', {}, 'aaaaaaaa.bbbbbbbb.zzzz');
    expect(unknown).toMatchObject({ ok: false, code: 'UNAUTHENTICATED', status: 401 });
    const expired = await client.rpc('is_admin', {}, world.tokens.expired);
    expect(expired).toMatchObject({ ok: false, code: 'UNAUTHENTICATED', status: 401 });

    const wrongKey = createSupabaseClient({ supabaseUrl: SHIM_SUPABASE_URL, anonKey: 'wrong-key', fetch: world.shim.fetch });
    expect(await wrongKey.rpc('is_admin', {}, world.tokens.admin)).toMatchObject({ ok: false, status: 401 });
  });

  it('storage_usage through the shim equals a direct SQL call', async () => {
    const viaShim = await client.rpc<Record<string, unknown>>('storage_usage', {}, world.tokens.admin);
    const direct = await asRole(
      world.db,
      'authenticated',
      (d) => d.query<{ u: Record<string, unknown> }>('select public.storage_usage() as u'),
      ADMIN_USER,
    );
    expect(viaShim).toEqual({ ok: true, data: direct.rows[0]!.u });
    expect(viaShim.ok && viaShim.data.used_bytes).toBe(12345);
  });

  it('a non-admin storage_usage call is refused (42501 becomes NOT_ADMIN)', async () => {
    expect(await client.rpc('storage_usage', {}, world.tokens.nonAdmin)).toMatchObject({
      ok: false,
      code: 'NOT_ADMIN',
      status: 403,
    });
  });

  it('select of photos: admin sees the row, non-admin sees zero rows (RLS), anon is denied', async () => {
    const admin = await client.select('photos', { select: 'id,bytes_total' }, world.tokens.admin);
    expect(admin).toEqual({ ok: true, data: [{ id: PHOTO, bytes_total: 12345 }] });
    expect(await client.select('photos', {}, world.tokens.nonAdmin)).toEqual({ ok: true, data: [] });

    const res = await world.shim.fetch(`${SHIM_SUPABASE_URL}/rest/v1/photos`, {
      headers: { apikey: SHIM_ANON_KEY, authorization: `Bearer ${SHIM_ANON_KEY}` },
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });

  it('supports eq, in, order, limit and paging through the client', async () => {
    await world.db.exec(
      `insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total)
       values ('${PHOTO2}', '${ALB}', 'photos/${PHOTO2}/master.jpg', 1, 1, '{}', 7)`,
    );
    const ordered = await client.select<{ id: string }>('photos', { select: 'id', order: 'bytes_total.asc' }, world.tokens.admin);
    expect(ordered).toEqual({ ok: true, data: [{ id: PHOTO2 }, { id: PHOTO }] });
    const eq = await client.select('photos', { select: 'id', id: `eq.${PHOTO}` }, world.tokens.admin);
    expect(eq).toEqual({ ok: true, data: [{ id: PHOTO }] });
    const inn = await client.select('photos', { select: 'id', id: `in.(${PHOTO2},${ALB})` }, world.tokens.admin);
    expect(inn).toEqual({ ok: true, data: [{ id: PHOTO2 }] });
    const paged = await client.select('photos', { select: 'id', order: 'id.asc' }, world.tokens.admin, { pageSize: 1 });
    expect(paged).toEqual({ ok: true, data: [{ id: PHOTO }, { id: PHOTO2 }] });
    await world.db.exec(`delete from public.photos where id = '${PHOTO2}'`);
  });

  it('a raise exception comes back as its code (STORAGE_FULL)', async () => {
    await world.db.exec('update public.app_config set quota_hard_bytes = 100, quota_warn_bytes = 50');
    const total = sumBytes(VARIANTS);
    const r = await client.rpc('register_photo', {
      p_id: 'cccccccc-0000-4000-8000-000000000009',
      p_album_id: ALB,
      p_width: 3000,
      p_height: 2000,
      p_variants: VARIANTS,
      p_bytes_total: total,
    }, world.tokens.admin);
    expect(r).toMatchObject({ ok: false, code: 'STORAGE_FULL', status: 400 });
    await world.db.exec('update public.app_config set quota_hard_bytes = 9500000000, quota_warn_bytes = 8000000000');
  });

  it('an unknown function or argument is a 404, not a crash', async () => {
    expect(await client.rpc('no_such_fn', {}, world.tokens.admin)).toMatchObject({ ok: false, status: 404 });
    expect(await client.rpc('is_admin', { bogus: 1 }, world.tokens.admin)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('makeWorld', () => {
  it('wires the Worker app to the shim: /health open, admin route auth through is_admin', async () => {
    const health = await world.app.fetch(new Request('https://api.example.test/health'), world.env);
    expect(health.status).toBe(200);
    expect(goodEnv().SUPABASE_URL).toBe(SHIM_SUPABASE_URL);
    expect(world.tokens.admin).not.toMatch(/^eyJ/);
  });

  it('runs concurrent requests one at a time without mixing roles', async () => {
    const results = await Promise.all([
      client.rpc('is_admin', {}, world.tokens.admin),
      client.rpc('is_admin', {}, world.tokens.nonAdmin),
      client.rpc('is_admin', {}, world.tokens.admin),
      client.rpc('is_admin', {}, world.tokens.nonAdmin),
    ]);
    expect(results.map((r) => r.ok && r.data)).toEqual([true, false, true, false]);
  });
});
