// T-200 (D-13 answer A): the live run writes the 141 legacy image redirects into url_history, and apps/web turns them
// into `_redirects` rows. Fake backend only, no network.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { allLegacyKeys, buildSnapshot } from '../../packages/shared/src';
import { buildRedirects, RedirectsError } from '../../apps/web/src/lib/redirects';
import { main } from '../migrate-legacy';
import { BackendError } from './backend';
import { createFakeBackend, type FakeBackend } from './fake-backend';
import { tempReportDir } from './report-dir.helper';
import { legacyRedirectRow, syncRedirects } from './url-history';

const BASE = 'https://img.example.test';
const PREFIX = '/fotky_web/galleries/';
const env = {
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
  SUPABASE_ANON_KEY: 'k',
  API_BASE_URL: 'https://api.example.test',
  MIGRATE_ACCESS_TOKEN: 'tok',
  PUBLIC_IMG_BASE_URL: BASE,
};

let tiny: Buffer;
beforeAll(async () => {
  tiny = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#336699' } }).jpeg().toBuffer();
});

const upload = () => ({ exists: () => true, read: async () => tiny, sleep: async () => {} });

async function liveRun(b: FakeBackend, extra: string[] = []) {
  const lines: string[] = [];
  const code = await main(['--live', '--confirm-project', 'abcdefgh', ...extra], (l) => lines.push(l), () => {}, { env, backend: b, upload: upload(), reportDir: tempReportDir('mig-uh-') });
  return { code, lines };
}

/** Legacy photos (from the legacy list) whose redirect line is not in the `_redirects` text. */
function missingRedirects(text: string, b: FakeBackend): string[] {
  const lines = new Set(text.split('\n'));
  return b.photos().flatMap((p) => {
    const row = legacyRedirectRow(p.legacy_key!, p.id, BASE);
    return lines.has(`${row.old_path} ${row.target} 301`) ? [] : [p.legacy_key!];
  });
}

function redirectsText(b: FakeBackend): string {
  const snapshot = buildSnapshot({ categories: b.categories(), albums: b.albums(), photos: b.photos(), urlHistory: b.urlHistory() }, new Date('2026-10-21T00:00:00Z'));
  return buildRedirects({ imgOrigin: BASE, data: snapshot.redirects });
}

describe('legacy image redirects in url_history', () => {
  it('inserts 141 rows once; a rerun adds nothing; the web build gets 141 image rows', async () => {
    const b = createFakeBackend();
    const first = await liveRun(b);
    expect(first.code).toBe(0);
    expect(b.photos()).toHaveLength(141);
    expect(first.lines.some((l) => l.includes('wanted 141, inserted 141, already present 0, changed 0'))).toBe(true);

    const rows = b.urlHistory();
    expect(rows).toHaveLength(141);
    expect(allLegacyKeys()).toHaveLength(141);
    for (const r of rows) {
      expect(r.status).toBe(301);
      expect(r.old_path.startsWith(PREFIX)).toBe(true);
      expect(r.target).toMatch(new RegExp(`^${BASE}/photos/[0-9a-f-]{36}/1600\\.jpg$`));
    }
    expect(rows.map((r) => r.old_path.slice(PREFIX.length)).sort()).toEqual([...allLegacyKeys()].sort());

    const second = await liveRun(b);
    expect(second.code).toBe(0);
    expect(b.urlHistory()).toEqual(rows);
    expect(second.lines.some((l) => l.includes('wanted 141, inserted 0, already present 141, changed 0'))).toBe(true);

    // redirects.ts accepts the absolute image-host targets and emits one line per photo.
    const text = redirectsText(b);
    const imageLines = text.split('\n').filter((l) => l.startsWith(PREFIX));
    expect(imageLines).toHaveLength(b.photos().length);
    expect(imageLines).toHaveLength(141);
    expect(missingRedirects(text, b)).toEqual([]);
  }, 60_000);

  it('detects a missing row, and the web validation refuses a foreign host', async () => {
    const b = createFakeBackend();
    expect((await liveRun(b)).code).toBe(0);
    const full = redirectsText(b);
    const victim = b.urlHistory()[0]!;
    const without = full
      .split('\n')
      .filter((l) => !l.startsWith(`${victim.old_path} `))
      .join('\n');
    expect(without.split('\n').filter((l) => l.startsWith(PREFIX))).toHaveLength(140);
    expect(missingRedirects(without, b)).toEqual([victim.old_path.slice(PREFIX.length)]);

    const snapshot = buildSnapshot({ categories: b.categories(), albums: b.albums(), photos: b.photos(), urlHistory: b.urlHistory() }, new Date('2026-10-21T00:00:00Z'));
    expect(() => buildRedirects({ imgOrigin: 'https://other.example.test', data: snapshot.redirects })).toThrow(RedirectsError);
  }, 60_000);

  it('a rerun with another image host ends INCOMPLETE (exit 1) and overwrites nothing', async () => {
    const b = createFakeBackend();
    expect((await liveRun(b)).code).toBe(0);
    const before = b.urlHistory();
    const lines: string[] = [];
    const code = await main(['--live', '--confirm-project', 'abcdefgh'], (l) => lines.push(l), () => {}, {
      env: { ...env, PUBLIC_IMG_BASE_URL: 'https://img.other.test' },
      backend: b,
      upload: upload(),
      reportDir: tempReportDir('mig-uh-'),
    });
    expect(code).toBe(1);
    expect(lines).toContain('RESULT: INCOMPLETE');
    expect(lines.some((l) => l.includes('changed 141'))).toBe(true);
    expect(b.urlHistory()).toEqual(before);
  }, 60_000);

  it('syncRedirects does not overwrite a changed row and reports it', async () => {
    const b = createFakeBackend();
    expect((await liveRun(b)).code).toBe(0);
    const key = allLegacyKeys()[0]!;
    const photo = b.photos().find((p) => p.legacy_key === key)!;
    const stored = legacyRedirectRow(key, photo.id, BASE);
    // Same path, other base: an admin edit or a PUBLIC_IMG_BASE_URL change between runs.
    const other = await syncRedirects(b, { album: null }, 'https://img.other.test');
    expect(other.inserted).toBe(0);
    expect(other.changed).toHaveLength(141);
    expect(other.changed.find((c) => c.old_path === stored.old_path)).toMatchObject({ old_path: stored.old_path, found_target: stored.target });
    expect(b.urlHistory().find((r) => r.old_path === stored.old_path)!.target).toBe(stored.target);
  }, 60_000);

  it('--album writes only that album\'s rows', async () => {
    const b = createFakeBackend();
    expect((await liveRun(b, ['--album', 'lucka_filip'])).code).toBe(0);
    expect(b.urlHistory()).toHaveLength(5);
    expect(b.urlHistory().every((r) => r.old_path.startsWith(`${PREFIX}couples/lucka_filip/`))).toBe(true);
  }, 60_000);

  it('a failing url_history write ends INCOMPLETE with exit 1', async () => {
    const b = createFakeBackend();
    b.failNext('addUrlHistory', new BackendError('NOT_ADMIN'));
    const dir = tempReportDir('mig-uh-');
    const lines: string[] = [];
    const code = await main(['--live', '--confirm-project', 'abcdefgh'], (l) => lines.push(l), () => {}, { env, backend: b, upload: upload(), reportDir: dir });
    expect(code).toBe(1);
    expect(lines).toContain('RESULT: INCOMPLETE');
    // The full report of the successful upload phase is kept, with the redirects block marked failed.
    const jsonFile = readdirSync(dir).find((f) => f.endsWith('.json'))!;
    const report = JSON.parse(readFileSync(join(dir, jsonFile), 'utf8'));
    expect(report.totals.inserted).toBe(141);
    expect(report.aborted).toBeNull();
    expect(report.redirects).toMatchObject({ error: 'NOT_ADMIN', wanted: 0 });
    expect(report.result).toBe('INCOMPLETE');
    expect(b.urlHistory()).toHaveLength(0);
    // The photos are in; a rerun completes the redirects.
    expect((await liveRun(b)).code).toBe(0);
    expect(b.urlHistory()).toHaveLength(141);
  }, 60_000);

  it('a dry-run reports 141 and writes nothing to the backend', async () => {
    const dir = tempReportDir('mig-uh-');
    const lines: string[] = [];
    const code = await main([], (l) => lines.push(l), () => {}, { plan: { exists: () => true, read: async () => tiny, publicImgBaseUrl: BASE }, reportDir: dir });
    expect(code).toBe(0);
    expect(lines.some((l) => l.startsWith('redirect lines 141'))).toBe(true);
    expect(readFileSync(join(dir, 'legacy-image-redirects.txt'), 'utf8').trimEnd().split('\n')).toHaveLength(141);
  }, 60_000);
});
