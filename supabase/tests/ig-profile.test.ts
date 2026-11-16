import type { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isValidIgAvatarKey } from '../../packages/shared/src/keys';
import { asRole, createMigratedDb, seedAdmin } from './helpers/db';
import { lintPublicSchema } from './helpers/privileges';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const CAT = 'aaaaaaaa-0000-4000-8000-000000000001';
const ALB = 'bbbbbbbb-0000-4000-8000-000000000001';
const PHOTO = 'cccccccc-0000-4000-8000-000000000001';
const PHOTO2 = 'cccccccc-0000-4000-8000-000000000002';
const AVATAR = 'ig/avatar/dddddddd-0000-4000-8000-000000000001.webp';

let db: PGlite;
const asAdmin = <T>(fn: (d: PGlite) => Promise<T>) => asRole(db, 'authenticated', fn, ADMIN);
const asOther = <T>(fn: (d: PGlite) => Promise<T>) => asRole(db, 'authenticated', fn, OTHER);

const set = (assignments: string) => `update public.ig_profile set ${assignments} where id`;
const profile = async () => (await db.query<Record<string, unknown>>('select * from public.ig_profile')).rows;
const count = async (table: string) =>
  (await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`)).rows[0]!.n;
const pending = async () =>
  (await db.query<{ n: number }>('select pending_changes as n from public.site_state')).rows[0]!.n;

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id, email) values ('${OTHER}', 'o@example.test')`);
  await seedAdmin(db, ADMIN, 'a@example.test');
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec(`
    update public.ig_profile set username = 'mullnyphotos', display_name = 'Mullny Photos', bio = '', link = '',
      followers_count = 0, following_count = 0, avatar_key = null;
    delete from public.ig_posts;
    delete from public.photos;
    update public.albums set cover_photo_id = null;
    delete from public.albums;
    delete from public.categories;
    delete from public.url_history;
    insert into public.categories (id, slug, name) values ('${CAT}', 'svatby', 'Svatby');
    insert into public.albums (id, category_id, slug, title, published) values ('${ALB}', '${CAT}', 'one', 'One', true);
    insert into public.photos (id, album_id, master_key, width, height, variants, bytes_total)
      values ('${PHOTO}', '${ALB}', 'photos/${PHOTO}/master.jpg', 1, 1, '{}', 0),
             ('${PHOTO2}', '${ALB}', 'photos/${PHOTO2}/master.jpg', 1, 1, '{}', 0);
    delete from public.change_log;
    update public.site_state set pending_changes = 0 where id;
  `);
});

describe('ig_profile: seed and constraints', () => {
  it('has exactly one seeded row with defaults', async () => {
    expect(await profile()).toEqual([
      expect.objectContaining({
        id: true,
        username: 'mullnyphotos',
        display_name: 'Mullny Photos',
        bio: '',
        link: '',
        followers_count: 0,
        following_count: 0,
        avatar_key: null,
      }),
    ]);
  });

  it('has avatar_key and no avatar_photo_id (column, foreign key and index are gone)', async () => {
    const cols = (
      await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'ig_profile'`,
      )
    ).rows.map((r) => r.column_name);
    expect(cols).toContain('avatar_key');
    expect(cols).not.toContain('avatar_photo_id');
    const idx = await db.query(`select 1 from pg_indexes where tablename = 'ig_profile' and indexname = 'ig_profile_avatar_photo_id_idx'`);
    expect(idx.rows).toEqual([]);
    const fk = await db.query(`select 1 from pg_constraint where conrelid = 'public.ig_profile'::regclass and contype = 'f'`);
    expect(fk.rows).toEqual([]);
  });

  it('a second row is refused (id must be true and unique)', async () => {
    await expect(db.exec(`insert into public.ig_profile (id) values (false)`)).rejects.toThrow(/ig_profile_single_row/);
    await expect(db.exec(`insert into public.ig_profile (id) values (true)`)).rejects.toThrow(/ig_profile_pkey/);
    expect(await count('ig_profile')).toBe(1);
  });

  it('username: 30 characters pass, 31 fail; letters, digits, dot and underscore only', async () => {
    await db.exec(set(`username = repeat('a', 30)`));
    await expect(db.exec(set(`username = repeat('a', 31)`))).rejects.toThrow(/ig_profile_username_length/);
    await db.exec(set(`username = 'Mullny.Photos_9'`));
    await db.exec(set(`username = ''`));
    for (const bad of ['a b', 'a-b', 'a@b', 'čau', 'a' + String.fromCharCode(10)]) {
      await expect(db.exec(set(`username = '${bad}'`)), bad).rejects.toThrow(/ig_profile_username_chars/);
    }
  });

  it('display name: 64 pass, 65 fail (an emoji counts as one character)', async () => {
    await db.exec(set(`display_name = repeat('a', 64)`));
    await db.exec(set(`display_name = repeat('😀', 64)`));
    await expect(db.exec(set(`display_name = repeat('a', 65)`))).rejects.toThrow(/ig_profile_name_length/);
  });

  it('bio: 150 pass (with line breaks), 151 fail', async () => {
    await db.exec(set(`bio = repeat('a', 74) || chr(10) || repeat('b', 75)`));
    await expect(db.exec(set(`bio = repeat('a', 151)`))).rejects.toThrow(/ig_profile_bio_length/);
  });

  it('link: 200 pass, 201 fail; empty, http and https (any case) pass, other schemes fail', async () => {
    await db.exec(set(`link = 'https://' || repeat('a', 192)`));
    await expect(db.exec(set(`link = 'https://' || repeat('a', 193)`))).rejects.toThrow(/ig_profile_link_length/);
    for (const ok of ['', 'http://x.cz', 'https://x.cz/a?b=1', 'HTTPS://X.CZ']) await db.exec(set(`link = '${ok}'`));
    for (const bad of ['ftp://x.cz', 'x.cz', 'javascript:alert(1)', ' https://x.cz', 'mailto:a@b.cz']) {
      await expect(db.exec(set(`link = '${bad}'`)), bad).rejects.toThrow(/ig_profile_link_scheme/);
    }
  });

  it('counts: 0 and 999999999 pass, negative and 1000000000 fail', async () => {
    await db.exec(set('followers_count = 999999999, following_count = 0'));
    await db.exec(set('followers_count = 0, following_count = 999999999'));
    await expect(db.exec(set('followers_count = -1'))).rejects.toThrow(/ig_profile_followers_range/);
    await expect(db.exec(set('followers_count = 1000000000'))).rejects.toThrow(/ig_profile_followers_range/);
    await expect(db.exec(set('following_count = -1'))).rejects.toThrow(/ig_profile_following_range/);
    await expect(db.exec(set('following_count = 1000000000'))).rejects.toThrow(/ig_profile_following_range/);
  });

  it('avatar_key: null and a valid ig/avatar key pass; path tricks, photo keys, wrong extension, uppercase fail', async () => {
    await db.exec(set(`avatar_key = '${AVATAR}'`));
    expect((await profile())[0]!.avatar_key).toBe(AVATAR);
    await db.exec(set(`avatar_key = null`));
    const id = 'dddddddd-0000-4000-8000-000000000001';
    const bad = [
      '../x',
      `photos/${PHOTO}/480.webp`,
      `ig/avatar/${id}.jpg`,
      `ig/avatar/${id.toUpperCase()}.webp`,
      `ig/avatar/../${id}.webp`,
      `/ig/avatar/${id}.webp`,
      `ig/avatar/${id}.webp.bak`,
      `ig/avatar/${id}.webp` + String.fromCharCode(10),
      '',
    ];
    for (const k of bad) {
      await expect(db.exec(set(`avatar_key = '${k}'`)), k).rejects.toThrow(/ig_profile_avatar_key_format/);
    }
    expect((await profile())[0]!.avatar_key).toBeNull();
  });

  it('the SQL check and isValidIgAvatarKey in packages/shared agree (parity)', async () => {
    const id = 'dddddddd-0000-4000-8000-000000000001';
    const keys = [
      AVATAR,
      '../x',
      `photos/${PHOTO}/480.webp`,
      `ig/avatar/${id}.jpg`,
      `ig/avatar/${id}.WEBP`,
      `ig/avatar/${id.toUpperCase()}.webp`,
      `ig/avatar/${id}`,
      `ig/avatar//${id}.webp`,
      `ig/avatars/${id}.webp`,
      `x/ig/avatar/${id}.webp`,
      `ig/avatar/${id}.webp` + String.fromCharCode(10),
      'ig/avatar/x.webp',
    ];
    for (const k of keys) {
      let sqlOk = true;
      try {
        await db.exec(set(`avatar_key = '${k}'`));
      } catch {
        sqlOk = false;
      }
      expect(sqlOk, k).toBe(isValidIgAvatarKey(k));
    }
  });

  it('updated_at moves on update', async () => {
    const q = 'select updated_at::text as t from public.ig_profile';
    const before = (await db.query<{ t: string }>(q)).rows[0]!.t;
    await db.exec(`select pg_sleep(0.01)`);
    await db.exec(set(`bio = 'x'`));
    expect((await db.query<{ t: string }>(q)).rows[0]!.t).not.toBe(before);
  });
});

describe('ig_profile: avatar is independent of photos', () => {
  it('deleting photos (also delete_photos) leaves the avatar key alone', async () => {
    await db.exec(set(`avatar_key = '${AVATAR}', bio = 'keep'`));
    await db.exec(`delete from public.photos where id = '${PHOTO}'`);
    await asAdmin((d) => d.query(`select public.delete_photos(array['${PHOTO2}']::uuid[])`));
    expect(await profile()).toEqual([expect.objectContaining({ avatar_key: AVATAR, bio: 'keep' })]);
  });
});

describe('ig_profile: privileges', () => {
  it('the schema lint is clean', async () => {
    expect(await lintPublicSchema(db)).toEqual([]);
  });

  it('anon can neither read nor write', async () => {
    await expect(asRole(db, 'anon', (d) => d.query('select * from public.ig_profile'))).rejects.toThrow(/permission denied/);
    await expect(asRole(db, 'anon', (d) => d.query(set(`bio = 'x'`)))).rejects.toThrow(/permission denied/);
    await expect(asRole(db, 'anon', (d) => d.query('insert into public.ig_profile (id) values (true)'))).rejects.toThrow(/permission denied/);
    await expect(asRole(db, 'anon', (d) => d.query('delete from public.ig_profile'))).rejects.toThrow(/permission denied/);
  });

  it('a signed-in non-admin sees nothing and changes nothing (row level security)', async () => {
    expect((await asOther((d) => d.query('select * from public.ig_profile'))).rows).toEqual([]);
    await asOther((d) => d.query(set(`bio = 'hacked'`)));
    expect((await profile())[0]!.bio).toBe('');
  });

  it('an admin can select and update the seven editable columns', async () => {
    await asAdmin((d) =>
      d.query(
        set(
          `username = 'adam', display_name = 'Adam', bio = 'Hi', link = 'https://x.cz', followers_count = 5, following_count = 6, avatar_key = '${AVATAR}'`,
        ),
      ),
    );
    const seen = await asAdmin((d) => d.query<Record<string, unknown>>('select * from public.ig_profile'));
    expect(seen.rows).toEqual([
      expect.objectContaining({
        username: 'adam',
        display_name: 'Adam',
        bio: 'Hi',
        link: 'https://x.cz',
        followers_count: 5,
        following_count: 6,
        avatar_key: AVATAR,
      }),
    ]);
  });

  it('an admin cannot insert, delete, or update id or updated_at', async () => {
    await expect(asAdmin((d) => d.query('insert into public.ig_profile (id) values (true)'))).rejects.toThrow(/permission denied/);
    await expect(asAdmin((d) => d.query('delete from public.ig_profile'))).rejects.toThrow(/permission denied/);
    await expect(asAdmin((d) => d.query(`update public.ig_profile set id = true`))).rejects.toThrow(/permission denied/);
    await expect(asAdmin((d) => d.query(`update public.ig_profile set updated_at = now()`))).rejects.toThrow(/permission denied/);
    expect(await count('ig_profile')).toBe(1);
  });

  it('the admin cannot push a bad value through the API (checks still apply)', async () => {
    await expect(asAdmin((d) => d.query(set(`username = 'bad name'`)))).rejects.toThrow(/ig_profile_username_chars/);
    await expect(asAdmin((d) => d.query(set(`avatar_key = '../x'`)))).rejects.toThrow(/ig_profile_avatar_key_format/);
  });

  it('has the two policies and nothing else', async () => {
    const r = await db.query<{ policyname: string; cmd: string }>(
      `select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'ig_profile' order by policyname`,
    );
    expect(r.rows).toEqual([
      { policyname: 'ig_profile_admin_select', cmd: 'SELECT' },
      { policyname: 'ig_profile_admin_update', cmd: 'UPDATE' },
    ]);
  });
});

describe('ig_profile: not tracked as a site change', () => {
  it('only set_updated_at is attached', async () => {
    const r = await db.query<{ tgname: string; fn: string }>(
      `select t.tgname, p.proname as fn from pg_trigger t join pg_proc p on p.oid = t.tgfoid
        where t.tgrelid = 'public.ig_profile'::regclass and not t.tgisinternal order by t.tgname`,
    );
    expect(r.rows).toEqual([{ tgname: 'ig_profile_set_updated_at', fn: 'set_updated_at' }]);
  });

  it('change_log and pending_changes stay unchanged by profile updates', async () => {
    const before = { p: await pending(), l: await count('change_log') };
    await asAdmin((d) => d.query(set(`bio = 'y', followers_count = 7, avatar_key = '${AVATAR}'`)));
    await asAdmin((d) => d.query(set(`avatar_key = null`)));
    expect({ p: await pending(), l: await count('change_log') }).toEqual(before);
  });

  it('no file of the Worker source or the snapshot builder mentions ig_profile', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const files = readdirSync(join(root, 'apps', 'api', 'src'), { recursive: true })
      .map((f) => String(f))
      // WP-16: the avatar cleanup route reads the saved avatar_key (read only, caller JWT) to know which file to keep.
      .filter((f) => /\.(ts|tsx)$/.test(f) && f !== join('routes', 'ig-avatar.ts'))
      .map((f) => join(root, 'apps', 'api', 'src', f));
    files.push(join(root, 'packages', 'shared', 'src', 'snapshot.ts'));
    expect(files.length).toBeGreaterThan(1);
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/ig_profile/);
  });

  it('the migration code (comments aside) touches no tracking function and defines no function', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const f of ['20261117090000_ig_profile.sql', '20261118090000_ig_profile_avatar_key.sql']) {
      const code = readFileSync(join(here, '..', 'migrations', f), 'utf8').replace(/^--.*$/gm, '');
      expect(code, f).not.toMatch(/bump_pending|log_change|record_publish|change_log/);
      expect(code, f).not.toMatch(/create (or replace )?function/);
    }
  });
});
