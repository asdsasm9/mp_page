// Alt text and report completeness (plan WP-06 step 12). FakeBackend only; synthetic image bytes.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { main } from '../migrate-legacy';
import { defaultAlt, effectiveAlt, validateAlt } from '../../packages/shared/src/alt';
import { LEGACY_ALBUMS, LEGACY_CATEGORIES } from '../../packages/shared/src/legacy/albums';
import type { MigrationBackend } from './backend';
import { albumIdOf, categoryIdOf } from './catalog';
import { createFakeBackend } from './fake-backend';
import { tempReportDir } from './report-dir.helper';

const SECRET = 'SENTINEL-pw';
const env = {
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  API_BASE_URL: 'https://api.example.test',
  MIGRATE_ACCESS_TOKEN: SECRET,
};

let tiny: Buffer;
beforeAll(async () => {
  tiny = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#336699' } }).jpeg().toBuffer();
});

async function run(backend: MigrationBackend, extra: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const reportDir = tempReportDir('mig-rep-');
  const upload = { exists: () => true, read: async () => tiny, sleep: async () => {} };
  const code = await main(['--live', '--confirm-project', 'abcdefgh', ...extra], (l) => out.push(l), (l) => err.push(l), {
    env,
    backend,
    upload,
    reportDir,
    now: () => new Date('2026-01-02T03:04:05.000Z'),
  });
  const files = readdirSync(reportDir).sort();
  const texts = files.map((f) => readFileSync(join(reportDir, f), 'utf8'));
  return { code, out: out.join('\n'), err: err.join('\n'), files, texts, reportDir };
}

describe('alt', () => {
  it('effectiveAlt is valid and unique within each album for all 141 photos', () => {
    let total = 0;
    for (const a of LEGACY_ALBUMS) {
      const seen = new Set<string>();
      for (let n = 1; n <= a.photoCount; n++) {
        const alt = effectiveAlt({ alt: null }, { albumTitle: a.title, categoryKey: a.categorySlug, n, total: a.photoCount });
        expect(validateAlt(alt).ok, alt).toBe(true);
        seen.add(alt);
        total++;
      }
      expect(seen.size).toBe(a.photoCount);
    }
    expect(total).toBe(141);
  });

  it('stores null by default', async () => {
    const b = createFakeBackend();
    const r = await run(b, ['--album', 'lucka']);
    expect(r.code).toBe(0);
    expect(b.photos().map((p) => p.alt)).toEqual([null, null, null, null, null]);
  });

  it('--alt default stores the same text effectiveAlt renders', async () => {
    const b = createFakeBackend();
    const r = await run(b, ['--album', 'lucka', '--alt', 'default']);
    expect(r.code).toBe(0);
    const a = LEGACY_ALBUMS.find((x) => x.id === 'lucka')!;
    const stored = b.photos().sort((x, y) => x.sort - y.sort).map((p) => p.alt);
    const expected = [1, 2, 3, 4, 5].map((n) => defaultAlt({ albumTitle: a.title, categoryKey: a.categorySlug, n, total: 5 }));
    expect(stored).toEqual(expected);
    expect(stored).toEqual(expected.map((_, i) => effectiveAlt({ alt: null }, { albumTitle: a.title, categoryKey: a.categorySlug, n: i + 1, total: 5 })));
  });
});

describe('live report files', () => {
  it('writes JSON and Markdown with per-album and total figures and no secrets', async () => {
    const b = createFakeBackend();
    const r = await run(b);
    expect(r.code).toBe(0);
    expect(r.files).toEqual(['2026-01-02T03-04-05-000Z.json', '2026-01-02T03-04-05-000Z.md']);
    const json = JSON.parse(r.texts[0]!);
    expect(json.result).toBe('OK');
    expect(json.albums).toHaveLength(13);
    expect(json.totals).toMatchObject({ found: 141, inserted: 141, skipped: 0, failed: 0, missing: 0, repaired: 0 });
    expect(json.totals.bytes).toBeGreaterThan(0);
    expect(json.quota.after).toBeGreaterThanOrEqual(json.quota.before);
    const lucka = json.albums.find((a: { id: string }) => a.id === 'lucka_filip');
    expect(lucka).toMatchObject({ found: 5, inserted: 5, coverNumber: 1, orderOk: true, coverStatus: 'set' });
    expect(lucka.coverId).toEqual(expect.any(String));
    expect(r.texts[1]).toContain('RESULT: OK');
    expect(r.texts[1]).toContain('lucka_filip');
    for (const text of [...r.texts, r.out, r.err]) {
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain('admin@example.test');
      expect(text).not.toContain('anon-key');
      expect(text).not.toMatch(/https?:\/\//);
    }
  }, 60_000);

  it('a failed photo gives RESULT: INCOMPLETE in output and files, and exit 1', async () => {
    const b = createFakeBackend();
    b.failNext('commit', 'server', 4);
    const r = await run(b, ['--album', 'lucka']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('RESULT: INCOMPLETE');
    const json = JSON.parse(r.texts[0]!);
    expect(json.result, r.err).toBe('INCOMPLETE');
    expect(json.totals.failed, r.err).toBe(1);
    expect(json.totals.inserted).toBe(4);
    expect(r.texts[1]).toContain('RESULT: INCOMPLETE');
    expect(r.texts.join('')).not.toContain(SECRET);
  });

  it('an unexpected exception in the cover phase still writes both files, INCOMPLETE, with a scrubbed label', async () => {
    const b = createFakeBackend();
    const boom: MigrationBackend = {
      ...b,
      async setCover() {
        throw new Error(`kaboom https://api.example.test/x?sig=abc by admin@example.test using ${SECRET} and anon-key, Bearer tok123`);
      },
    };
    const r = await run(boom, ['--album', 'lucka']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('RESULT: INCOMPLETE');
    expect(r.files).toEqual(['2026-01-02T03-04-05-000Z.json', '2026-01-02T03-04-05-000Z.md']);
    const json = JSON.parse(r.texts[0]!);
    expect(json.result).toBe('INCOMPLETE');
    expect(json.aborted).toContain('upload phase failed: kaboom [url] by [email] using [redacted] and [redacted], Bearer [redacted]');
    expect(r.texts[1]).toContain('ABORTED: upload phase failed');
    expect(r.texts[1]).toContain('RESULT: INCOMPLETE');
    for (const text of r.texts) {
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain('admin@example.test');
      expect(text).not.toContain('anon-key');
      expect(text).not.toContain('tok123');
      expect(text).not.toMatch(/https?:\/\//);
    }
  });

  it('writes an empty drift list when the catalog matches', async () => {
    const r = await run(createFakeBackend(), ['--album', 'lucka']);
    expect(JSON.parse(r.texts[0]!).drift).toEqual([]);
    expect(r.texts[1]).toContain('catalog drift: 0');
  });

  it('puts catalog drift into the JSON and Markdown files', async () => {
    const b = createFakeBackend();
    await b.signIn();
    const cat = LEGACY_CATEGORIES.find((c) => c.slug === LEGACY_ALBUMS.find((a) => a.id === 'lucka')!.categorySlug)!;
    const c = await b.upsertCategory({ id: categoryIdOf(cat.slug), slug: cat.slug, name: 'Jiné jméno', sort: cat.sort });
    await b.upsertAlbum({ id: albumIdOf('lucka'), category_id: c.id, slug: 'lucka', title: 'Lucka renamed', place: 'Praha', sort: 7, legacy_id: 'lucka', published: true });
    const r = await run(b, ['--album', 'lucka']);
    expect(r.code).toBe(0);
    const json = JSON.parse(r.texts[0]!);
    const keys = json.drift.map((d: { kind: string; ref: string; field: string }) => `${d.kind}:${d.ref}:${d.field}`);
    expect(keys).toEqual(expect.arrayContaining(['album:lucka:title', 'album:lucka:sort', 'category:' + cat.slug + ':name']));
    expect(json.drift.find((d: { field: string; ref: string }) => d.ref === 'lucka' && d.field === 'title')).toMatchObject({ expected: expect.any(String), actual: 'Lucka renamed' });
    expect(r.texts[1]).toContain(`catalog drift: ${json.drift.length}`);
    expect(r.texts[1]).toContain('DRIFT album lucka title');
  });
});
