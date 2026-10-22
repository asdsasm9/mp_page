import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedDb } from './helpers/db';
import { lintPublicSchema } from './helpers/privileges';

const CAT = 'aaaaaaaa-0000-4000-8000-000000000001';
const CAT2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const ALB1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const ALB2 = 'bbbbbbbb-0000-4000-8000-000000000002';

let db: PGlite;

const history = async () =>
  (
    await db.query<{ old_path: string; target: string | null; status: number }>(
      'select old_path, target, status from public.url_history order by old_path',
    )
  ).rows;

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`
    insert into public.categories (id, slug, name) values ('${CAT}', 'svatby', 'Svatby'), ('${CAT2}', 'portrety', 'Portréty');
    insert into public.albums (id, category_id, slug, title) values
      ('${ALB1}', '${CAT}', 'one', 'One'), ('${ALB2}', '${CAT}', 'two', 'Two');
  `);
});

afterAll(async () => {
  await db.close();
});

describe('migration F: slug history', () => {
  it('writes nothing when no slug changes', async () => {
    await db.exec(`update public.albums set title = 'Uno' where id = '${ALB1}'`);
    expect(await history()).toEqual([]);
  });

  it('renaming an album slug writes a 301 from the old path', async () => {
    await db.exec(`update public.albums set slug = 'uno' where id = '${ALB1}'`);
    expect(await history()).toEqual([{ old_path: '/svatby/one/', target: '/svatby/uno/', status: 301 }]);
  });

  it('a second rename repoints the earlier redirect (no chains)', async () => {
    await db.exec(`update public.albums set slug = 'eins' where id = '${ALB1}'`);
    expect(await history()).toEqual([
      { old_path: '/svatby/one/', target: '/svatby/eins/', status: 301 },
      { old_path: '/svatby/uno/', target: '/svatby/eins/', status: 301 },
    ]);
  });

  it('renaming back removes the redirect that started at the restored path', async () => {
    await db.exec(`update public.albums set slug = 'one' where id = '${ALB1}'`);
    const rows = await history();
    expect(rows.find((r) => r.old_path === '/svatby/one/')).toBeUndefined();
    expect(rows).toContainEqual({ old_path: '/svatby/eins/', target: '/svatby/one/', status: 301 });
    expect(rows).toContainEqual({ old_path: '/svatby/uno/', target: '/svatby/one/', status: 301 });
    await db.exec('delete from public.url_history');
  });

  it('moving an album to another category writes a 301 to the new path', async () => {
    await db.exec(`update public.albums set category_id = '${CAT2}' where id = '${ALB2}'`);
    expect(await history()).toEqual([{ old_path: '/svatby/two/', target: '/portrety/two/', status: 301 }]);
    await db.exec(`update public.albums set category_id = '${CAT}' where id = '${ALB2}'`);
    await db.exec('delete from public.url_history');
  });

  it('changing a category slug writes rows for the category and its albums', async () => {
    await db.exec(`update public.categories set slug = 'svatba' where id = '${CAT}'`);
    expect(await history()).toEqual([
      { old_path: '/svatby/', target: '/svatba/', status: 301 },
      { old_path: '/svatby/one/', target: '/svatba/one/', status: 301 },
      { old_path: '/svatby/two/', target: '/svatba/two/', status: 301 },
    ]);
    await db.exec('delete from public.url_history');
  });

  it('deleting an album writes a 410 row', async () => {
    await db.exec(`delete from public.albums where id = '${ALB2}'`);
    expect(await history()).toEqual([{ old_path: '/svatba/two/', target: null, status: 410 }]);
  });

  it('the trigger functions are not exposed: the catalog lint is still clean', async () => {
    expect(await lintPublicSchema(db)).toEqual([]);
  });
});
