import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BackupDocument } from '../../packages/shared/src/backup';
import { emitRestoreSql, sqlLiteral } from './sql';

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(here, '..', '__golden__', 'restore-tiny.sql');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TS = '2026-10-19T12:00:00.000Z';

function tinyDoc(): BackupDocument {
  const p1 = uuid(31);
  const p2 = uuid(32);
  const variants = {
    master: { w: 3000, h: 2000, bytes: 1000 },
    webp: [{ tier: 480 as const, w: 480, h: 320, bytes: 20 }],
    jpeg: { w: 1600, h: 1067, bytes: 300 },
    og: { w: 1200, h: 630, bytes: 100 },
  };
  return {
    schemaVersion: 1,
    generatedAt: TS,
    // Deliberately not in id order: the output must be sorted.
    categories: [
      { id: uuid(2), slug: 'portrety', name: "O'Brien & syn", description: null, seo_title: null, seo_description: null, sort: 20, visible: false, created_at: TS, updated_at: TS },
      { id: uuid(1), slug: 'svatby', name: 'Svatby', description: 'Zlatý déšť; "ok"', seo_title: null, seo_description: null, sort: 10, visible: true, created_at: TS, updated_at: TS },
    ],
    albums: [
      { id: uuid(11), category_id: uuid(1), slug: 'frankovi', title: 'Frankovi', place: null, shot_on: '2024-06-01', description: null, seo_title: null, seo_description: null, cover_photo_id: p2, sort: 10, published: true, legacy_id: 'frankovi', created_at: TS, updated_at: TS },
      { id: uuid(12), category_id: uuid(2), slug: 'bez-fotek', title: 'Bez fotek', place: null, shot_on: null, description: null, seo_title: null, seo_description: null, cover_photo_id: null, sort: 20, published: false, legacy_id: null, created_at: TS, updated_at: TS },
    ],
    photos: [
      { id: p2, album_id: uuid(11), master_key: `photos/${p2}/master.jpg`, width: 3000, height: 2000, variants, bytes_total: 1420, dominant_color: '#aabbcc', alt: 'Pár na louce', caption: null, sort: 20, legacy_key: null, created_at: TS, updated_at: TS },
      { id: p1, album_id: uuid(11), master_key: `photos/${p1}/master.jpg`, width: 3000, height: 2000, variants, bytes_total: 1420, dominant_color: null, alt: null, caption: 'Řádek\ndva', sort: 10, legacy_key: null, created_at: TS, updated_at: TS },
    ],
    urlHistory: [
      { id: uuid(41), old_path: '/svatby/stary/', target: '/svatby/frankovi/', status: 301, created_at: TS },
      { id: uuid(42), old_path: '/svatby/smazano/', target: null, status: 410, created_at: TS },
    ],
  };
}

describe('emitRestoreSql', () => {
  it('matches the golden file and is identical on a second run', () => {
    const first = emitRestoreSql(tinyDoc());
    const second = emitRestoreSql(tinyDoc());
    expect(second).toBe(first);
    // First run only: record the golden file, then review it by eye and commit it.
    if (!existsSync(GOLDEN)) {
      mkdirSync(dirname(GOLDEN), { recursive: true });
      writeFileSync(GOLDEN, first);
    }
    expect(first).toBe(readFileSync(GOLDEN, 'utf8'));
  });

  it('is independent of input row order', () => {
    const a = tinyDoc();
    const b = tinyDoc();
    b.categories.reverse();
    b.photos.reverse();
    b.albums.reverse();
    expect(emitRestoreSql(b)).toBe(emitRestoreSql(a));
  });

  it('keeps foreign-key order and the transaction frame', () => {
    const sql = emitRestoreSql(tinyDoc());
    const at = (s: string) => sql.indexOf(s);
    const marks = [
      '\nbegin;',
      '\nalter table public.categories disable trigger user;',
      'insert into public.categories',
      'insert into public.albums',
      'insert into public.photos',
      'insert into public.url_history',
      'update public.albums set cover_photo_id',
      'enable trigger user',
      'update public.site_state set pending_changes',
      '\ncommit;',
    ].map(at);
    expect(marks.every((m) => m >= 0)).toBe(true);
    expect([...marks].sort((x, y) => x - y)).toEqual(marks);
    expect(sql.match(/on conflict \(id\) do nothing;/g)).toHaveLength(4);
    expect(sql).not.toMatch(/^\s*delete\s/im);
    expect(sql.match(/^update /gm)).toHaveLength(2);
  });

  it('handles an empty catalog', () => {
    const sql = emitRestoreSql({ schemaVersion: 1, generatedAt: TS, categories: [], albums: [], photos: [], urlHistory: [] });
    expect(sql).not.toContain('insert into');
    expect(sql).toContain('begin;');
    expect(sql).toContain('commit;');
  });

  it('documents order, triggers, idempotency and the fallback in the header', () => {
    const sql = emitRestoreSql(tinyDoc());
    const header = sql.slice(0, sql.indexOf('begin;'));
    for (const word of ['Order', 'disable trigger user', 'fallback', 'Idempotency', 'never deletes', 'drop trigger']) {
      expect(header).toContain(word);
    }
  });
});

describe('sqlLiteral', () => {
  const cases: [string, unknown, string][] = [
    ['plain', 'abc', "'abc'"],
    ['single quote', "it's", "'it''s'"],
    ['only quotes', "''", "''''''"],
    ['semicolon', "a'; drop table photos; --", "'a''; drop table photos; --'"],
    ['comment marker', 'x -- y', "'x -- y'"],
    ['backslash', 'a\\b', "E'a\\\\b'"],
    ['backslash then quote', "\\'", "E'\\\\'''"],
    ['dollar quoting', '$$ ; $tag$', "'$$ ; $tag$'"],
    ['newline', 'a\nb', "'a\nb'"],
    ['emoji', 'fotka \u{1F4F7}', "'fotka \u{1F4F7}'"],
    ['czech', 'Žluťoučký kůň', "'Žluťoučký kůň'"],
    ['empty', '', "''"],
    ['null', null, 'null'],
    ['integer', 42, '42'],
    ['negative', -7, '-7'],
    ['true', true, 'true'],
    ['false', false, 'false'],
    ['json object', { a: "it's" }, `'{"a":"it''s"}'::jsonb`],
    ['json with backslash', { a: 'x"y' }, `E'{"a":"x\\\\"y"}'::jsonb`],
    ['json array', [1, 2], "'[1,2]'::jsonb"],
    ['timestamp string', '2026-10-19T12:00:00.000Z', "'2026-10-19T12:00:00.000Z'"],
  ];
  it.each(cases)('%s', (_name, input, expected) => {
    expect(sqlLiteral(input)).toBe(expected);
  });

  it('keeps a very long string whole', () => {
    const long = "x'".repeat(100_000);
    const out = sqlLiteral(long);
    expect(out).toBe("'" + "x''".repeat(100_000) + "'");
  });

  it('rejects NUL bytes, non-finite numbers, lone surrogates and unsupported types', () => {
    expect(() => sqlLiteral('a\u0000b')).toThrow();
    expect(() => sqlLiteral({ a: 'a\u0000b' })).toThrow();
    expect(() => sqlLiteral(NaN)).toThrow();
    expect(() => sqlLiteral(Infinity)).toThrow();
    expect(() => sqlLiteral('\uD800')).toThrow();
    expect(() => sqlLiteral(undefined)).toThrow();
    expect(() => sqlLiteral(() => 1)).toThrow();
    expect(() => sqlLiteral(new Date())).toThrow();
  });

  it('does not echo rejected values in the error', () => {
    expect(() => sqlLiteral('secret\u0000value')).toThrow(/^(?!.*secret)/);
  });

  it('puts hostile document strings only inside literals in the emitted script', () => {
    const doc = tinyDoc();
    const hostile = "x'); drop table public.photos; -- \\ $$ \n\u{1F4F7}";
    doc.albums[0]!.title = hostile;
    const sql = emitRestoreSql(doc);
    expect(sql).toContain(sqlLiteral(hostile));
    expect(sql).not.toContain("'x'); drop");
  });
});

describe('emitter source', () => {
  const source = readFileSync(join(here, 'sql.ts'), 'utf8');

  it('never interpolates into templates or reads names from document keys', () => {
    expect(source).not.toContain('${');
    expect(source).not.toContain('`');
    expect(source).not.toMatch(/Object\.(keys|entries|values)\(/);
  });

  it('only reaches row values through sqlLiteral', () => {
    // Row/album property reads in the emitter are either fed to sqlLiteral or used for filtering/sorting.
    const reads = source.split('\n').filter((l) => /\b(row|album|a|b)\[?\.?[a-z_]*\b/.test(l) && /row\[c\]|album\./.test(l));
    for (const line of reads) {
      expect(line.includes('sqlLiteral(') || line.includes('filter(')).toBe(true);
    }
  });

  it('is pure: no network, fs or child_process', () => {
    expect(source).not.toMatch(/\bfetch\(|node:fs|node:child_process|node:http|XMLHttpRequest|require\(/);
  });
});
