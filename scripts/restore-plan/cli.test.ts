import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HUMAN_STEPS, parseArgs, run, type RunDeps } from './cli';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TS = '2026-10-19T12:00:00.000Z';
const SECRET_TITLE = 'Tajny-titulek-12345';

function goodDoc() {
  const p1 = uuid(31);
  const variants = {
    master: { w: 3000, h: 2000, bytes: 1000 },
    webp: [{ tier: 480, w: 480, h: 320, bytes: 20 }],
    jpeg: { w: 1600, h: 1067, bytes: 300 },
    og: { w: 1200, h: 630, bytes: 100 },
  };
  return {
    schemaVersion: 1,
    generatedAt: TS,
    categories: [
      { id: uuid(1), slug: 'svatby', name: 'Svatby', description: null, seo_title: null, seo_description: null, sort: 10, visible: true, created_at: TS, updated_at: TS },
    ],
    albums: [
      { id: uuid(11), category_id: uuid(1), slug: 'frankovi', title: SECRET_TITLE, place: null, shot_on: null, description: null, seo_title: null, seo_description: null, cover_photo_id: p1, sort: 10, published: true, legacy_id: null, created_at: TS, updated_at: TS },
    ],
    photos: [
      { id: p1, album_id: uuid(11), master_key: `photos/${p1}/master.jpg`, width: 3000, height: 2000, variants, bytes_total: 1420, dominant_color: null, alt: null, caption: null, sort: 10, legacy_key: null, created_at: TS, updated_at: TS },
    ],
    urlHistory: [],
  };
}

function orphanAlbumDoc() {
  const d = goodDoc();
  d.albums[0]!.category_id = uuid(99);
  return d;
}

interface Fake {
  deps: RunDeps;
  files: Map<string, string>;
  out: string[];
  err: string[];
  writes: string[];
  renames: [string, string][];
}

function fake(files: Record<string, string>): Fake {
  const map = new Map(Object.entries(files));
  const f: Fake = { files: map, out: [], err: [], writes: [], renames: [], deps: undefined as never };
  f.deps = {
    readFile: (p) => {
      const t = map.get(p);
      if (t === undefined) throw new Error('ENOENT');
      return t;
    },
    writeFile: (p, t) => {
      f.writes.push(p);
      map.set(p, t);
    },
    rename: (a, b) => {
      f.renames.push([a, b]);
      map.set(b, map.get(a)!);
      map.delete(a);
    },
    exists: (p) => map.has(p),
    log: (l) => f.out.push(l),
    error: (l) => f.err.push(l),
  };
  return f;
}

describe('parseArgs', () => {
  it('parses all flags', () => {
    expect(parseArgs(['--from', 'a', '--out', 'b', '--force'])).toEqual({ from: 'a', out: 'b', check: false, force: true, help: false });
  });
});

describe('restore-plan run', () => {
  it('--check on a good file exits 0, prints counts and integrity OK, writes nothing', () => {
    const f = fake({ 'catalog.json': JSON.stringify(goodDoc()) });
    expect(run(['--from', 'catalog.json', '--check'], f.deps)).toBe(0);
    const text = f.out.join('\n');
    expect(text).toContain('categories: 1');
    expect(text).toContain('albums: 1');
    expect(text).toContain('photos: 1');
    expect(text).toContain('url_history: 0');
    expect(text).toContain('integrity OK');
    expect(f.writes).toEqual([]);
    expect(f.renames).toEqual([]);
  });

  it('a bad file (orphan album) fails with the path and no values, and writes nothing', () => {
    const f = fake({ 'bad.json': JSON.stringify(orphanAlbumDoc()) });
    expect(run(['--from', 'bad.json', '--out', 'r.sql'], f.deps)).not.toBe(0);
    const text = f.err.join('\n');
    expect(text).toContain('albums.0.category_id');
    expect(text).not.toContain(SECRET_TITLE);
    expect(text).not.toContain(uuid(99));
    expect(f.writes).toEqual([]);
    expect(f.out.join('\n')).not.toContain('integrity OK');
  });

  it('--check on a bad file is non-zero too', () => {
    const f = fake({ 'bad.json': JSON.stringify(orphanAlbumDoc()) });
    expect(run(['--from', 'bad.json', '--check'], f.deps)).not.toBe(0);
  });

  it('non-JSON and missing files fail without leaking content', () => {
    const f = fake({ 'x.json': 'not json SECRETTEXT' });
    expect(run(['--from', 'x.json', '--check'], f.deps)).not.toBe(0);
    expect(run(['--from', 'missing.json', '--check'], f.deps)).not.toBe(0);
    expect(f.err.join('\n')).not.toContain('SECRETTEXT');
  });

  it('refuses to overwrite without --force, overwrites with --force', () => {
    const f = fake({ 'catalog.json': JSON.stringify(goodDoc()), 'r.sql': 'old' });
    expect(run(['--from', 'catalog.json', '--out', 'r.sql'], f.deps)).not.toBe(0);
    expect(f.err.join('\n')).toContain('--force');
    expect(f.files.get('r.sql')).toBe('old');
    expect(run(['--from', 'catalog.json', '--out', 'r.sql', '--force'], f.deps)).toBe(0);
    expect(f.files.get('r.sql')).not.toBe('old');
    expect(f.files.get('r.sql')).toContain('begin;');
  });

  it('writes atomically: temp file first, then rename onto the target', () => {
    const f = fake({ 'catalog.json': JSON.stringify(goodDoc()) });
    expect(run(['--from', 'catalog.json', '--out', 'r.sql'], f.deps)).toBe(0);
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0]).not.toBe('r.sql');
    expect(f.renames).toEqual([[f.writes[0], 'r.sql']]);
    expect(f.files.has(f.writes[0]!)).toBe(false);
    expect(f.files.get('r.sql')).toContain('begin;');
  });

  it('prints the human steps after writing', () => {
    const f = fake({ 'catalog.json': JSON.stringify(goodDoc()) });
    run(['--from', 'catalog.json', '--out', 'r.sql'], f.deps);
    const text = f.out.join('\n');
    for (const line of HUMAN_STEPS) expect(text).toContain(line);
    expect(text).toContain('supabase db push');
    expect(text).toContain('docs/ADMIN.md step 5');
    expect(text).toContain('SQL editor');
    expect(text).toContain('disable trigger user');
  });

  it('accepts a full-*.json shaped document', () => {
    const f = fake({ 'full-2026-10-19T12-00-00Z.json': JSON.stringify(goodDoc()) });
    expect(run(['--from', 'full-2026-10-19T12-00-00Z.json', '--out', 'r.sql'], f.deps)).toBe(0);
  });

  it('unknown flag, missing --from, missing --out print usage and fail', () => {
    for (const argv of [['--bogus'], ['--out', 'r.sql'], ['--from', 'a.json'], ['--from']]) {
      const f = fake({ 'a.json': JSON.stringify(goodDoc()) });
      expect(run(argv, f.deps)).toBe(2);
      expect(f.err.join('\n')).toContain('Usage:');
      expect(f.writes).toEqual([]);
    }
  });

  it('--help prints usage and exits 0', () => {
    const f = fake({});
    expect(run(['--help'], f.deps)).toBe(0);
    expect(f.out.join('\n')).toContain('Usage:');
  });
});

describe('restore-plan sources are offline', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const banned = /fetch\(|http|XMLHttpRequest|child_process|node:net|node:https?|node:dgram|node:tls/;
  for (const file of [join(here, 'cli.ts'), join(here, '..', 'restore-plan.ts')]) {
    it(`${file.split('/').pop()} has no network access`, () => {
      expect(readFileSync(file, 'utf8')).not.toMatch(banned);
    });
  }
});
