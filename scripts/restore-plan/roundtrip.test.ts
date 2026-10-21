/**
 * WP8-9: PGlite round trip for the restore SQL. Migrations + seed -> read the four catalog tables into
 * a BackupDocument -> verifyBackupDocument -> truncate as owner -> run emitRestoreSql -> read back.
 * Offline: PGlite is in-process, nothing here opens a network connection.
 */
import type { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sumBytes, variantPlan, verifyBackupDocument, type PhotoVariants } from '@mp/shared';
import type { BackupDocument } from '../../packages/shared/src/backup';
import { createMigratedDb } from '../../supabase/tests/helpers/db';
import { emitRestoreSql } from './sql';

const CAT1 = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const CAT2 = 'aaaaaaaa-0000-4000-8000-0000000000a2';
const ALB_COVER = 'bbbbbbbb-0000-4000-8000-0000000000b1';
const ALB_DRAFT = 'bbbbbbbb-0000-4000-8000-0000000000b2';
const ALB_EMPTY = 'bbbbbbbb-0000-4000-8000-0000000000b3';
const P1 = 'cccccccc-0000-4000-8000-0000000000c1';
const P2 = 'cccccccc-0000-4000-8000-0000000000c2';
const P3 = 'cccccccc-0000-4000-8000-0000000000c3';
const UH1 = 'dddddddd-0000-4000-8000-0000000000d1';
const UH2 = 'dddddddd-0000-4000-8000-0000000000d2';

/** Timestamps are read as ISO text with microseconds so nothing is rounded on the way. */
const TS = (col: string) => `to_char(${col} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

async function readCatalog(db: PGlite): Promise<BackupDocument> {
  const q = async <T>(sql: string) => (await db.query<T>(sql)).rows;
  const categories = await q<BackupDocument['categories'][number]>(
    `select id, slug, name, description, seo_title, seo_description, sort, visible,
            ${TS('created_at')} as created_at, ${TS('updated_at')} as updated_at
       from public.categories order by id`,
  );
  const albums = await q<BackupDocument['albums'][number]>(
    `select id, category_id, slug, title, place, shot_on::text as shot_on, description, seo_title, seo_description,
            cover_photo_id, sort, published, legacy_id,
            ${TS('created_at')} as created_at, ${TS('updated_at')} as updated_at
       from public.albums order by id`,
  );
  const photos = await q<BackupDocument['photos'][number]>(
    `select id, album_id, master_key, width, height, variants, bytes_total::int as bytes_total, dominant_color,
            alt, caption, sort, legacy_key,
            ${TS('created_at')} as created_at, ${TS('updated_at')} as updated_at
       from public.photos order by id`,
  );
  const urlHistory = await q<BackupDocument['urlHistory'][number]>(
    `select id, old_path, target, status, ${TS('created_at')} as created_at from public.url_history order by id`,
  );
  return { schemaVersion: 1, generatedAt: '2026-10-21T08:00:00.000Z', categories, albums, photos, urlHistory };
}

/** Everything except generatedAt (a property of the read, not of the data). */
function dataOf(doc: BackupDocument) {
  const { generatedAt: _ignored, ...rest } = doc;
  return rest;
}

const hashOf = (doc: BackupDocument) => createHash('sha256').update(JSON.stringify(dataOf(doc))).digest('hex');
const counts = (doc: BackupDocument) => [doc.categories.length, doc.albums.length, doc.photos.length, doc.urlHistory.length];

function variantsFor(w: number, h: number, bytes: number): PhotoVariants {
  const p = variantPlan(w, h);
  return {
    master: { w: p.master.w, h: p.master.h, bytes },
    webp: p.webp.map((e) => ({ tier: e.tier as 480, w: e.w, h: e.h, bytes })),
    jpeg: { w: p.jpeg.w, h: p.jpeg.h, bytes },
    og: { w: p.og.w, h: p.og.h, bytes },
  };
}
const totalBytes = (v: PhotoVariants) => sumBytes(v);
const lit = (s: string) => "'" + s.split("'").join("''") + "'";

async function triggerStates(db: PGlite) {
  return (
    await db.query<{ tgname: string; tgenabled: string }>(
      `select t.tgname, t.tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where c.relnamespace = 'public'::regnamespace
          and c.relname in ('categories', 'albums', 'photos', 'url_history') and not t.tgisinternal
        order by t.tgname`,
    )
  ).rows;
}
const pending = async (db: PGlite) =>
  Number((await db.query<{ n: number }>('select pending_changes as n from public.site_state')).rows[0]!.n);
const truncateCatalog = (db: PGlite) =>
  db.exec('truncate public.url_history, public.photos, public.albums, public.categories cascade');

let db: PGlite;

beforeAll(async () => {
  db = await createMigratedDb();
  const small = variantsFor(400, 300, 7); // one webp entry (fallback tier), different jsonb shape
  const big = variantsFor(3000, 2000, 1234); // all five tiers
  const mid = variantsFor(1000, 1500, 55);
  await db.exec(`
    insert into public.categories (id, slug, name, description, seo_title, sort, visible, created_at, updated_at)
      values ('${CAT1}', 'svatby', 'Svatby', 'Zlatý déšť', 'Svatby SEO', 10, true,
              '2025-03-04T05:06:07.123456Z', '2025-03-05T05:06:07.654321Z'),
             ('${CAT2}', 'portrety', 'Portréty', null, null, 20, false, now(), now());
    insert into public.albums (id, category_id, slug, title, place, shot_on, description, sort, published, legacy_id)
      values ('${ALB_COVER}', '${CAT1}', 'frankovi', 'Frankovi', 'Praha', '2024-06-01', 'Popis', 10, true, 'frankovi'),
             ('${ALB_DRAFT}', '${CAT1}', 'koncept', 'Koncept', null, null, null, 20, false, null),
             ('${ALB_EMPTY}', '${CAT2}', 'bez-fotek', 'Bez fotek', null, '2023-01-31', null, 5, true, 'bez_fotek');
    insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total, dominant_color, alt, caption, sort, legacy_key)
      values ('${P1}', '${ALB_COVER}', 'photos/${P1}/master.jpg', 3000, 2000, '${JSON.stringify(big)}'::jsonb, ${totalBytes(big)}, '#aabbcc', 'Pár na louce', 'Řádek', 10, 'f/1.jpg'),
             ('${P2}', '${ALB_COVER}', 'photos/${P2}/master.jpg', 400, 300, '${JSON.stringify(small)}'::jsonb, ${totalBytes(small)}, null, null, null, 20, null),
             ('${P3}', '${ALB_DRAFT}', 'photos/${P3}/master.jpg', 1000, 1500, '${JSON.stringify(mid)}'::jsonb, ${totalBytes(mid)}, '#000000', 'Portrét', null, 0, null);
    update public.albums set cover_photo_id = '${P1}' where id = '${ALB_COVER}';
    insert into public.url_history (id, old_path, target, status, created_at) values
      ('${UH1}', '/svatby/stary/', '/svatby/frankovi/', 301, '2026-01-02T03:04:05.000001Z'),
      ('${UH2}', '/svatby/smazano/', null, 410, now());
  `);
});

afterAll(async () => {
  await db.close();
});

describe('restore SQL round trip in PGlite', () => {
  it('restores a truncated catalog exactly, then a second run changes nothing', async () => {
    const before = await readCatalog(db);
    expect(counts(before)).toEqual([2, 3, 3, 2]);
    expect(before.albums.find((a) => a.id === ALB_COVER)!.cover_photo_id).toBe(P1);
    expect(before.albums.find((a) => a.id === ALB_DRAFT)!.published).toBe(false);
    expect(before.photos.find((p) => p.id === P2)!.variants.webp).toHaveLength(1);
    expect(before.photos.find((p) => p.id === P1)!.variants.webp).toHaveLength(5);

    const verdict = verifyBackupDocument(before);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    const sql = emitRestoreSql(verdict.doc);

    await truncateCatalog(db);
    await db.exec('update public.site_state set pending_changes = 0');
    expect(counts(await readCatalog(db))).toEqual([0, 0, 0, 0]);

    await db.exec(sql);
    const after = await readCatalog(db);
    expect(dataOf(after)).toEqual(dataOf(before));
    expect(verifyBackupDocument(after).ok).toBe(true);
    // Triggers were off during the run: original timestamps kept, counter set once, not once per row.
    expect(await pending(db)).toBe(1);

    const hash = hashOf(after);
    await db.exec(sql);
    const again = await readCatalog(db);
    expect(counts(again)).toEqual(counts(after));
    expect(hashOf(again)).toBe(hash);
    expect(await pending(db)).toBe(1);
  });

  it('leaves every user trigger on the catalog tables enabled and the pending counter above zero', async () => {
    const triggers = await triggerStates(db);
    // Migration triggers: set_updated_at x3, bump_pending x4, check_cover, clear_cover, slug history x3.
    expect(triggers.length).toBeGreaterThanOrEqual(10);
    expect(triggers.filter((t) => t.tgenabled !== 'O')).toEqual([]);
    expect(await pending(db)).toBeGreaterThan(0);
  });

  it('really switched the triggers off during the run (disable trigger user works in PGlite)', async () => {
    const doc = await readCatalog(db);
    const sql = emitRestoreSql(doc);
    await truncateCatalog(db);
    await db.exec('update public.site_state set pending_changes = 0');
    await db.exec(sql);
    // With triggers firing the 10 inserted rows would have counted at least 10.
    expect(await pending(db)).toBe(1);
    expect((await triggerStates(db)).filter((t) => t.tgenabled !== 'O')).toEqual([]);
  });

  it('a failing script rolls back and leaves triggers enabled', async () => {
    const doc = await readCatalog(db);
    const clash = structuredClone(doc);
    clash.categories.push({ ...clash.categories[0]!, id: 'aaaaaaaa-0000-4000-8000-0000000000ff' }); // same slug, new id
    await expect(db.exec(emitRestoreSql(clash))).rejects.toThrow();
    await db.exec('rollback').catch(() => undefined);
    expect((await triggerStates(db)).filter((t) => t.tgenabled !== 'O')).toEqual([]);
    expect(counts(await readCatalog(db))).toEqual(counts(doc));
  });

  it('stores hostile strings exactly as given', async () => {
    const hostile = [
      "x'); drop table public.photos; -- y",
      'semi;colon -- not a comment',
      'back\\slash \\\' \\n \\\\',
      '$$ $tag$ body $tag$ $$',
      'line1\nline2\r\nline3\ttab',
      'emoji \u{1F4F7} \u{1F468}‍\u{1F469}‍\u{1F467} Žluťoučký kůň',
      "''''",
      'x'.repeat(5000),
    ];
    const doc = await readCatalog(db);
    // categories.description is unconstrained; photos.caption <= 500 chars, alt <= 300 chars.
    doc.categories[0]!.name = hostile[0]!;
    doc.categories[0]!.description = hostile.join('\n---\n');
    doc.categories[1]!.description = hostile[7]!;
    doc.albums[0]!.title = hostile[0]!;
    doc.albums[0]!.description = hostile[2]!;
    doc.albums[1]!.title = hostile[3]!;
    doc.photos[0]!.caption = hostile[4]!;
    doc.photos[1]!.caption = hostile[5]!;
    doc.photos[1]!.alt = hostile[6]!;
    doc.photos[2]!.alt = hostile[1]!;
    doc.urlHistory[0]!.target = '/x/' + hostile[2]!;
    const verdict = verifyBackupDocument(doc);
    expect(verdict.ok).toBe(true);

    await truncateCatalog(db);
    await db.exec(emitRestoreSql(doc));
    const after = await readCatalog(db);
    expect(dataOf(after)).toEqual(dataOf(doc));
    // Nothing the hostile strings tried to do happened: the tables are all still there.
    expect(counts(after)).toEqual(counts(doc));
    const direct = await db.query<{ d: string }>(`select description as d from public.categories where id = ${lit(doc.categories[1]!.id)}`);
    expect(direct.rows[0]!.d).toBe(hostile[7]);
  });
});
