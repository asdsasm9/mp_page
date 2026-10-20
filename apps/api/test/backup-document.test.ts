import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backupKey, createFakeStorage, variantPlan, verifyBackupDocument, type PhotoVariants } from '@mp/shared';
import { buildAndStoreSnapshot } from '../src/publish-service';
import { createSupabaseClient } from '../src/supabase';
import { SHIM_ANON_KEY, SHIM_SUPABASE_URL, makeWorld, type World } from './supabase-shim';

const CAT = 'aaaaaaaa-0000-4000-8000-000000000011';
const ALB = 'bbbbbbbb-0000-4000-8000-000000000011';
const ALB_DRAFT = 'bbbbbbbb-0000-4000-8000-000000000012';
const PHOTO = 'cccccccc-0000-4000-8000-000000000011';
const T0 = new Date('2026-10-19T12:00:00.000Z');

function variants(): PhotoVariants {
  const p = variantPlan(1200, 800);
  return {
    master: { w: p.master.w, h: p.master.h, bytes: 10 },
    webp: p.webp.map((e) => ({ tier: e.tier as 480, w: e.w, h: e.h, bytes: 10 })),
    jpeg: { w: p.jpeg.w, h: p.jpeg.h, bytes: 10 },
    og: { w: p.og.w, h: p.og.h, bytes: 10 },
  };
}

let world: World;
beforeAll(async () => {
  world = await makeWorld();
});
afterAll(() => world.close());

describe('Worker backup output vs BackupDocumentSchema', () => {
  it('the full-*.json written by buildAndStoreSnapshot validates', async () => {
    await world.db.exec(`
      insert into public.categories (id, slug, name, visible) values ('${CAT}', 'svatby-bk', 'Svatby', true);
      insert into public.albums (id, category_id, slug, title, published) values
        ('${ALB}', '${CAT}', 'one-bk', 'One', true), ('${ALB_DRAFT}', '${CAT}', 'draft-bk', 'Draft', false);
      insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total)
        values ('${PHOTO}', '${ALB}', 'photos/${PHOTO}/master.jpg', 1200, 800, '${JSON.stringify(variants())}'::jsonb, 60);
      update public.albums set cover_photo_id = '${PHOTO}' where id = '${ALB}';
    `);
    const publicBucket = createFakeStorage({ baseUrl: 'https://img.test' });
    const backupBucket = createFakeStorage({ baseUrl: 'https://backup.invalid' });
    const supabase = createSupabaseClient({
      supabaseUrl: SHIM_SUPABASE_URL,
      anonKey: SHIM_ANON_KEY,
      fetch: world.shim.fetch,
    });
    const bodies = new Map<string, Uint8Array>();
    const put = backupBucket.put.bind(backupBucket);
    backupBucket.put = async (key, body, opts) => {
      bodies.set(key, body);
      return put(key, body, opts);
    };
    await buildAndStoreSnapshot({ supabase, publicBucket, backupBucket, now: () => T0 }, world.tokens.admin);

    const body = bodies.get(backupKey(T0));
    expect(body).toBeDefined();
    const doc = JSON.parse(new TextDecoder().decode(body));
    const verdict = verifyBackupDocument(doc);
    expect(verdict).toEqual({ ok: true, doc });
    expect(doc.photos).toHaveLength(1);
    expect(doc.albums).toHaveLength(2);
  });
});
