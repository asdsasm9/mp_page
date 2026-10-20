import type { AlbumRow, PhotoRow } from '@mp/shared';
import { describe, expect, it } from 'vitest';
import { checkAlt, hasNoAlt } from './altText';
import { groupAlbums } from './albumSearch';
import { pickAutoCover, planAppend } from './photoActions';

const photo = (id: string, sort: number): PhotoRow => ({ id, sort }) as PhotoRow;

describe('pickAutoCover (auto-cover helper)', () => {
  const photos = [photo('b', 20), photo('a', 10), photo('c', 30)];
  it('takes the first photo by order when the album has no cover', () => {
    expect(pickAutoCover({ cover_photo_id: null }, photos)).toBe('a');
  });
  it('takes the first photo when the cover is not among the photos', () => {
    expect(pickAutoCover({ cover_photo_id: 'gone' }, photos)).toBe('a');
  });
  it('never replaces a cover the photographer chose', () => {
    expect(pickAutoCover({ cover_photo_id: 'c' }, photos)).toBeNull();
  });
  it('picks nothing for an album without photos', () => {
    expect(pickAutoCover({ cover_photo_id: null }, [])).toBeNull();
  });
});

describe('planAppend', () => {
  it('appends after the last photo of the target in the given order, step 10', () => {
    expect(planAppend([photo('x', 10), photo('y', 40)], ['p', 'q', 'r'])).toEqual([
      { id: 'p', sort: 50 },
      { id: 'q', sort: 60 },
      { id: 'r', sort: 70 },
    ]);
  });
  it('starts at 10 for an empty target', () => {
    expect(planAppend([], ['p'])).toEqual([{ id: 'p', sort: 10 }]);
  });
});

describe('alt text checks', () => {
  it('maps validateAlt problems to Czech and keeps warnings apart', () => {
    expect(checkAlt('IMG_1.JPG').problems).toEqual(['Alternativní text nesmí vypadat jako název souboru.']);
    expect(checkAlt('foto dortu').problems[0]).toContain('Nezačínejte');
    expect(checkAlt('a/b').problems).toEqual(['Alternativní text nesmí obsahovat lomítka.']);
    expect(checkAlt('x'.repeat(301)).problems).toEqual(['Alternativní text může mít nejvýše 300 znaků.']);
    const long = checkAlt('x'.repeat(130));
    expect(long.problems).toEqual([]);
    expect(long.warnings).toHaveLength(1);
    expect(checkAlt('Svatební dort').problems).toEqual([]);
  });
  it('treats blank alt as missing', () => {
    expect(hasNoAlt({ alt: null })).toBe(true);
    expect(hasNoAlt({ alt: '  ' })).toBe(true);
    expect(hasNoAlt({ alt: 'ok' })).toBe(false);
  });
});

describe('groupAlbums', () => {
  const categories = [
    { id: 'c2', name: 'Portréty', sort: 20 },
    { id: 'c1', name: 'Svatby', sort: 10 },
  ] as never[];
  const albums = [
    { id: 'a1', category_id: 'c1', title: 'Dvořákovi', sort: 10 },
    { id: 'a2', category_id: 'c1', title: 'Novákovi', sort: 20 },
    { id: 'a3', category_id: 'c2', title: 'Eva', sort: 10 },
  ] as AlbumRow[];
  it('groups by category in order and leaves out the source album', () => {
    const groups = groupAlbums(categories, albums, 'a2', '');
    expect(groups.map((g) => [g.category.name, g.albums.map((a) => a.id)])).toEqual([
      ['Svatby', ['a1']],
      ['Portréty', ['a3']],
    ]);
  });
  it('searches titles and category names without diacritics', () => {
    expect(groupAlbums(categories, albums, 'x', 'dvorak').flatMap((g) => g.albums.map((a) => a.id))).toEqual(['a1']);
    expect(groupAlbums(categories, albums, 'x', 'portret').flatMap((g) => g.albums.map((a) => a.id))).toEqual(['a3']);
  });
});
