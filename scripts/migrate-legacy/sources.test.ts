import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGACY_ALBUMS, allLegacyKeys } from '../../packages/shared/src/legacy/albums';
import { FIXTURE_NAMESPACE, uuidV5 } from '../gen-fixtures';
import {
  MIGRATION_NAMESPACE,
  SourcePathError,
  discoverSources,
  photoIdOf,
  resolveSourcePath,
} from './sources';

const DIR = resolve('/tmp/galleries-test');
const allExist = () => true;

describe('source discovery', () => {
  it('finds all 141 real legacy files on disk', () => {
    const d = discoverSources();
    expect(d.total).toBe(141);
    expect(d.missing).toEqual([]);
  });

  it('finds 141 files in 13 albums with the CONTENT-MAPPING counts', () => {
    const d = discoverSources({ galleriesDir: DIR, exists: allExist });
    expect(d.albums).toHaveLength(13);
    expect(d.total).toBe(141);
    expect(d.missing).toEqual([]);
    const counts = Object.fromEntries(d.albums.map((a) => [a.album.id, a.photos.length]));
    expect(counts).toMatchObject({ sedlakovi: 44, mia: 20, pati: 12, pavla_rafael: 11, anez: 9, hradsti: 8 });
    for (const a of d.albums) {
      expect(a.photos.map((p) => p.n)).toEqual(Array.from({ length: a.album.photoCount }, (_, i) => i + 1));
      expect(a.photos.every((p) => p.path.startsWith(DIR))).toBe(true);
    }
  });

  it('follows allLegacyKeys order', () => {
    const d = discoverSources({ galleriesDir: DIR, exists: allExist });
    expect(d.albums.flatMap((a) => a.photos.map((p) => p.legacyKey))).toEqual(allLegacyKeys());
  });

  it('reports missing files', () => {
    const gone = join(DIR, 'weddings', 'frankovi', '3.jpg');
    const d = discoverSources({ galleriesDir: DIR, exists: (p) => p !== gone });
    expect(d.missing).toEqual(['weddings/frankovi/3.jpg']);
  });

  it('limits to one album and rejects an unknown one', () => {
    const d = discoverSources({ galleriesDir: DIR, exists: allExist, album: 'lucka_filip' });
    expect(d.albums.map((a) => a.album.id)).toEqual(['lucka_filip']);
    expect(d.total).toBe(5);
    expect(() => discoverSources({ galleriesDir: DIR, album: 'nope' })).toThrow(SourcePathError);
  });
});

describe('photo identity', () => {
  it('ids are stable, unique, v5-shaped and differ from fixture ids', () => {
    const keys = allLegacyKeys();
    const ids = keys.map(photoIdOf);
    expect(ids).toEqual(keys.map(photoIdOf));
    expect(new Set(ids).size).toBe(141);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const fixtureIds = new Set(keys.map((k) => uuidV5(`photo:${k}`)));
    expect(ids.some((id) => fixtureIds.has(id))).toBe(false);
    expect(MIGRATION_NAMESPACE).not.toBe(FIXTURE_NAMESPACE);
  });

  it('pins a known id so the namespace cannot change by accident', () => {
    expect(photoIdOf('couples/lucka_filip/1.jpg')).toBe(uuidV5('photo:couples/lucka_filip/1.jpg', MIGRATION_NAMESPACE));
    expect(LEGACY_ALBUMS).toHaveLength(13);
  });
});

describe('path safety', () => {
  it('rejects traversal, absolute and malformed keys', () => {
    for (const bad of [
      '../weddings/x/1.jpg',
      'weddings/../../etc/1.jpg',
      '/etc/passwd',
      'weddings/x/1.png',
      'weddings/x/0.jpg',
      'other/x/1.jpg',
      'weddings/x/y/1.jpg',
      '',
    ]) {
      expect(() => resolveSourcePath(DIR, bad), bad).toThrow(SourcePathError);
    }
  });

  it('accepts a plain key under the directory', () => {
    expect(resolveSourcePath(DIR, 'weddings/sedlakovi/12.jpg')).toBe(join(DIR, 'weddings', 'sedlakovi', '12.jpg'));
  });
});
