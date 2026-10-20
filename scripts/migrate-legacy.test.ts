import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseArgs, USAGE } from './migrate-legacy/args';
import { planMigration, PlanError } from './migrate-legacy/planner';
import { GALLERIES_DIR } from './migrate-legacy/sources';
import { main } from './migrate-legacy';

describe('migrate-legacy scaffold', () => {
  it('--help prints usage and exits 0', async () => {
    const lines: string[] = [];
    expect(await main(['--help'], (l) => lines.push(l))).toBe(0);
    expect(lines.join('\n')).toBe(USAGE);
    expect(USAGE).toContain('--confirm-project');
  });

  it('defaults to a dry-run', () => {
    const o = parseArgs([]);
    expect(o.live).toBe(false);
    expect(o.confirmProject).toBeNull();
    expect(o.alt).toBe('null');
  });

  it('parses flags with values', () => {
    const o = parseArgs(['--live', '--confirm-project', 'abc', '--album', 'lucka_filip', '--limit-bytes', '100', '--repair', '--alt', 'default']);
    expect(o).toMatchObject({ live: true, confirmProject: 'abc', album: 'lucka_filip', limitBytes: 100, repair: true, alt: 'default' });
  });

  it('exits 2 on unknown or malformed options', async () => {
    const quiet = () => {};
    expect(await main(['--nope'], quiet, quiet)).toBe(2);
    expect(await main(['--album'], quiet, quiet)).toBe(2);
    expect(await main(['--limit-bytes', 'x'], quiet, quiet)).toBe(2);
  });
});

describe('migrate-legacy dry-run', () => {
  let jpeg: Buffer;
  beforeAll(async () => {
    jpeg = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 120, g: 80, b: 40 } } }).jpeg().toBuffer();
  });
  afterEach(() => vi.restoreAllMocks());

  const plan = () => ({ exists: () => true, read: async () => jpeg, publicImgBaseUrl: 'https://img.example.test' });
  const run = async (argv: string[], reportDir: string, stamp: string) => {
    const lines: string[] = [];
    const errs: string[] = [];
    const code = await main(argv, (l) => lines.push(l), (l) => errs.push(l), { plan: plan(), reportDir, now: () => new Date(stamp) });
    return { code, text: lines.join('\n'), errs: errs.join('\n') };
  };

  it('plans 3/13/141, writes only migration-report/, makes no network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    const r = await run([], join(dir, 'migration-report'), '2026-01-01T00:00:00Z');
    vi.unstubAllGlobals();
    expect(r.code).toBe(0);
    expect(r.text).toContain('categories 3, albums 13, photos 141');
    expect(r.text).toContain('RESULT: OK');
    expect(r.text).toMatch(/lucka_filip\s+found 5 planned 5/);
    expect(r.text).toMatch(/sedlakovi\s+found 44 planned 44 failed 0 bytes \d+ cover #42/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toEqual(['migration-report']);
    expect(readdirSync(join(dir, 'migration-report')).sort()).toEqual(['2026-01-01T00-00-00-000Z.json', '2026-01-01T00-00-00-000Z.md', 'legacy-image-redirects.txt']);
  }, 30_000);

  it('writes 141 redirect lines in CONTENT-MAPPING 7.3 format', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    await run([], dir, '2026-01-01T00:00:00Z');
    const lines = readFileSync(join(dir, 'legacy-image-redirects.txt'), 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(141);
    const re = /^\/fotky_web\/galleries\/(weddings|portraits|couples)\/[a-z0-9_]+\/[1-9][0-9]*\.jpg https:\/\/img\.example\.test\/photos\/[0-9a-f-]{36}\/1600\.jpg 301$/;
    for (const l of lines) expect(l).toMatch(re);
    expect(new Set(lines.map((l) => l.split(' ')[0])).size).toBe(141);
  }, 30_000);

  it('is byte-identical across two dry-runs', async () => {
    const dirA = mkdtempSync(join(tmpdir(), 'mig-'));
    const dirB = mkdtempSync(join(tmpdir(), 'mig-'));
    const a = await run(['--album', 'sedlakovi'], dirA, '2026-01-01T00:00:00Z');
    const b = await run(['--album', 'sedlakovi'], dirB, '2026-06-01T00:00:00Z');
    expect(b.text).toBe(a.text);
    const f = (d: string) => readFileSync(join(d, 'legacy-image-redirects.txt'), 'utf8');
    expect(f(dirB)).toBe(f(dirA));
  }, 30_000);

  it('--album limits the plan', async () => {
    const r = await run(['--album', 'lucka_filip'], mkdtempSync(join(tmpdir(), 'mig-')), '2026-01-01T00:00:00Z');
    expect(r.text).toContain('albums 1, photos 5');
    expect(r.code).toBe(0);
  });

  it('a missing source file fails the planner and writes nothing', async () => {
    await expect(planMigration({ album: null, limitBytes: null }, { exists: (p) => !p.endsWith('/lucka_filip/3.jpg'), read: async () => jpeg })).rejects.toThrow(PlanError);
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    const errs: string[] = [];
    const code = await main([], () => {}, (l) => errs.push(l), { plan: { exists: () => false }, reportDir: join(dir, 'r') });
    expect(code).toBe(1);
    expect(errs.join()).toContain('missing 141');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('an undecodable file makes the result INCOMPLETE with exit 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    const lines: string[] = [];
    const code = await main(['--album', 'lucka_filip'], (l) => lines.push(l), () => {}, {
      plan: { exists: () => true, read: async () => Buffer.from('not an image') },
      reportDir: dir,
    });
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('RESULT: INCOMPLETE');
  });

  // The full real dry-run takes about 36 s, so the suite only runs two small real albums (skipped if the legacy files are absent).
  it.skipIf(!existsSync(join(GALLERIES_DIR, 'couples', 'lucka_filip', '1.jpg')))('plans two real albums with real encoded sizes', async () => {
    for (const album of ['lucka_filip', 'pati2']) {
      const lines: string[] = [];
      const code = await main(['--album', album], (l) => lines.push(l), () => {}, { reportDir: mkdtempSync(join(tmpdir(), 'mig-')) });
      expect(code).toBe(0);
      expect(lines.join('\n')).toMatch(/planned R2 bytes [1-9]\d+/);
    }
  }, 60_000);

  it('--live is not accepted by the dry-run path', async () => {
    const errs: string[] = [];
    expect(await main(['--live'], () => {}, (l) => errs.push(l))).toBe(2);
  });
});
