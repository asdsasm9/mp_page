// Alt text and report completeness (plan WP-06 step 12). FakeBackend only; synthetic image bytes.
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { main } from '../migrate-legacy';
import { defaultAlt, effectiveAlt, validateAlt } from '../../packages/shared/src/alt';
import { LEGACY_ALBUMS } from '../../packages/shared/src/legacy/albums';
import { createFakeBackend } from './fake-backend';

const SECRET = 'SENTINEL-pw';
const env = {
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  API_BASE_URL: 'https://api.example.test',
  MIGRATE_ADMIN_EMAIL: 'admin@example.test',
  MIGRATE_ADMIN_PASSWORD: SECRET,
};

let tiny: Buffer;
beforeAll(async () => {
  tiny = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#336699' } }).jpeg().toBuffer();
});

async function run(backend: ReturnType<typeof createFakeBackend>, extra: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const reportDir = mkdtempSync(join(tmpdir(), 'mig-rep-'));
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
    expect(json.result).toBe('INCOMPLETE');
    expect(json.totals.failed).toBe(1);
    expect(json.totals.inserted).toBe(4);
    expect(r.texts[1]).toContain('RESULT: INCOMPLETE');
    expect(r.texts.join('')).not.toContain(SECRET);
  });
});
