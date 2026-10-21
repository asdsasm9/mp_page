// Backup CLI against FAKES only: fake Supabase, fake image host, in-memory fs. No network, no disk, no .env.
import { describe, expect, it } from 'vitest';
import { masterKey, verifyBackupDocument } from '../../packages/shared/src';
import type { FetchLike } from '../migrate-legacy/http-backend';
import { run as restorePlan } from '../restore-plan/cli';
import { parseArgs, run, USAGE, type CliDeps } from './cli';
import type { BackupFs } from './masters';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TS = '2026-10-19T12:00:00.000Z';
const SUPA = 'https://abcdefgh.supabase.co';
const IMG = 'https://img.example.test';
const ADMIN_ID = uuid(900);
const IDS = [uuid(11), uuid(12)];
const REPO = '/work/repo';
const OUT = '/backups/mullny';

const rnd = () => Math.random().toString(36).slice(2, 10);
const PASSWORD = ['pw', rnd(), 'x9'].join('-');
const ANON = ['anon', rnd(), 'z5'].join('_');
const EMAIL = `admin-${rnd()}@example.test`;
const SECRETS = [PASSWORD, ANON, EMAIL];

const bytesFor = (id: string) => new TextEncoder().encode(`JPEG:${id}:${'x'.repeat(40)}`);
const dec = new TextDecoder();

const variants = {
  master: { w: 3000, h: 2000, bytes: 1000 },
  webp: [{ tier: 480, w: 480, h: 320, bytes: 20 }, { tier: 960, w: 960, h: 640, bytes: 30 }],
  jpeg: { w: 1600, h: 1067, bytes: 300 },
  og: { w: 1200, h: 630, bytes: 100 },
};
const rows: Record<string, unknown[]> = {
  categories: [{ id: uuid(1), slug: 'svatby', name: 'Svatby', description: null, seo_title: null, seo_description: null, sort: 10, visible: true, created_at: TS, updated_at: TS }],
  albums: [{ id: uuid(2), category_id: uuid(1), slug: 'frankovi', title: 'Frankovi', place: null, shot_on: '2024-06-01', description: null, seo_title: null, seo_description: null, cover_photo_id: IDS[0], sort: 10, published: true, legacy_id: null, created_at: TS, updated_at: TS }],
  photos: IDS.map((id, i) => ({ id, album_id: uuid(2), master_key: masterKey(id), width: 3000, height: 2000, variants, bytes_total: 1450, dominant_color: null, alt: null, caption: null, sort: i, legacy_key: null, created_at: TS, updated_at: TS })),
  url_history: [{ id: uuid(4), old_path: '/old', target: '/new', status: 301, created_at: TS }],
};

function memFs() {
  const files = new Map<string, Uint8Array>();
  const fs: BackupFs = {
    async mkdir() {},
    async readFile(p) { return files.get(p) ?? null; },
    async writeFile(p, d) { files.set(p, d); },
    async rename(a, b) { files.set(b, files.get(a)!); files.delete(a); },
    async rm(p) { files.delete(p); },
  };
  return { files, fs };
}

function fakeFetch(missing: string[] = []): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const j = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    if (url.startsWith(IMG)) {
      const id = /photos\/([^/]+)\/master\.jpg$/.exec(url)?.[1] ?? '';
      if (missing.includes(id)) return new Response('no', { status: 404 });
      return new Response(bytesFor(id) as unknown as BodyInit, { status: 200 });
    }
    if (url.includes('/auth/v1/token')) return j({ access_token: 'tok', user: { id: ADMIN_ID } });
    const table = new URL(url).pathname.replace('/rest/v1/', '');
    if (table === 'admins') return j([{ user_id: ADMIN_ID }]);
    return j(rows[table] ?? []);
  };
  return { fetch, calls };
}

const LIVE_ENV = { SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: ANON, PUBLIC_IMG_BASE_URL: IMG, MIGRATE_ADMIN_EMAIL: EMAIL, MIGRATE_ADMIN_PASSWORD: PASSWORD };

function harness(over: Partial<CliDeps> = {}, listing: string[] | null = null) {
  const out: string[] = [];
  const err: string[] = [];
  const m = memFs();
  const f = fakeFetch();
  const deps: CliDeps = {
    env: LIVE_ENV,
    cwd: REPO,
    repoRoot: REPO,
    fs: m.fs,
    listDir: async () => listing,
    fetch: f.fetch,
    sleep: async () => {},
    now: () => new Date(TS),
    log: (l) => out.push(l),
    error: (l) => err.push(l),
    ...over,
  };
  return { deps, out, err, files: m.files, calls: f.calls };
}

const boom = () => { throw new Error('touched'); };
const throwingFs: BackupFs = { mkdir: boom, readFile: boom, writeFile: boom, rename: boom, rm: boom };

describe('parseArgs', () => {
  it('defaults to dry-run with caps', () => {
    const a = parseArgs(['--out', '/x']);
    expect(a).toMatchObject({ out: '/x', live: false, update: false, help: false });
    expect(a.maxPhotos).toBeGreaterThan(0);
  });
  it('rejects bad input', () => {
    expect(() => parseArgs([])).toThrow('--out');
    expect(() => parseArgs(['--out'])).toThrow('needs a value');
    expect(() => parseArgs(['--out', '/x', '--max-photos', '0'])).toThrow('positive');
    expect(() => parseArgs(['--out', '/x', '--max-bytes', '1e9'])).toThrow('positive');
    expect(() => parseArgs(['--out', '/x', '--bogus'])).toThrow('unknown argument');
    expect(() => parseArgs(['--out', '/x', '--live', '--dry-run'])).toThrow('exclude');
  });
});

describe('backup CLI', () => {
  it('--help lists every flag and exits 0 without --out', async () => {
    const h = harness();
    expect(await run(['--help'], h.deps)).toBe(0);
    const text = h.out.join('\n');
    for (const flag of ['--out', '--live', '--dry-run', '--update', '--max-photos', '--max-bytes', '--help']) {
      expect(text).toContain(flag);
      expect(USAGE).toContain(flag);
    }
  });

  it('dry-run (the default) touches nothing: fs, listing and fetch all throw', async () => {
    const h = harness({ fs: throwingFs, listDir: boom as never, fetch: boom as never });
    expect(await run(['--out', OUT], h.deps)).toBe(0);
    expect(await run(['--out', OUT, '--dry-run'], h.deps)).toBe(0);
    const text = h.out.join('\n');
    expect(text).toContain('DRY RUN');
    expect(text).toContain(OUT);
    expect(text).toContain('--update off');
    for (const s of SECRETS) expect(text).not.toContain(s);
  });

  it('dry-run names unset variables, never values', async () => {
    const h = harness({ env: { SUPABASE_URL: SUPA, MIGRATE_ADMIN_PASSWORD: PASSWORD } });
    await run(['--out', OUT], h.deps);
    const text = h.out.join('\n');
    expect(text).toContain('SUPABASE_ANON_KEY');
    expect(text).not.toContain(PASSWORD);
  });

  it('--live without guard variables refuses, naming variable names only', async () => {
    const h = harness({ env: { SUPABASE_URL: SUPA, MIGRATE_ADMIN_PASSWORD: PASSWORD }, fs: throwingFs, fetch: boom as never, listDir: boom as never });
    expect(await run(['--out', OUT, '--live'], h.deps)).toBe(2);
    const text = h.err.join('\n');
    for (const name of ['SUPABASE_ANON_KEY', 'PUBLIC_IMG_BASE_URL', 'MIGRATE_ADMIN_EMAIL']) expect(text).toContain(name);
    expect(text).not.toContain('SUPABASE_URL,');
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(SUPA);
  });

  it('--live rejects a malformed URL without echoing it', async () => {
    const h = harness({ env: { ...LIVE_ENV, PUBLIC_IMG_BASE_URL: 'http://user:pw@img.example.test' }, fs: throwingFs, fetch: boom as never });
    expect(await run(['--out', OUT, '--live'], h.deps)).toBe(2);
    expect(h.err.join('\n')).not.toContain('user:pw');
  });

  it('live run writes the backup and prints counts, bytes, skipped and failed', async () => {
    const h = harness();
    expect(await run(['--out', OUT, '--live'], h.deps)).toBe(0);
    const text = h.out.join('\n');
    expect(text).toContain('1 categories, 1 albums, 2 photos, 1 url_history');
    expect(text).toContain('2 written, 0 skipped');
    expect(text).toContain('0 failed');
    expect(text).toContain(`${bytesFor(IDS[0]!).byteLength * 2} downloaded now`);
    expect(text).toContain('RESULT: OK');
    expect(h.files.has(`${OUT}/catalog.json`)).toBe(true);
    expect(h.files.has(`${OUT}/manifest.json`)).toBe(true);
    // a rerun reports skipped
    const again = harness({ fs: memFsWith(h.files) });
    expect(await run(['--out', OUT, '--live'], again.deps)).toBe(0);
    expect(again.out.join('\n')).toContain('0 written, 2 skipped');
    // secrets nowhere in output or files
    const hay = [text, ...h.err, ...[...h.files.values()].map((v) => dec.decode(v))].join('\n');
    for (const s of SECRETS) expect(hay).not.toContain(s);
  });

  it('exits non-zero on a failed photo, lists its id only, still writes the rest', async () => {
    const ff = fakeFetch([IDS[1]!]);
    const h = harness({ fetch: ff.fetch });
    expect(await run(['--out', OUT, '--live'], h.deps)).toBe(1);
    const text = h.out.join('\n');
    expect(text).toContain(`failed:   ${IDS[1]} (NOT_FOUND 404)`);
    expect(text).toContain('1 written');
    expect(text).toContain('INCOMPLETE');
    expect(text).not.toContain(IMG);
    expect(h.files.has(`${OUT}/masters/${IDS[0]}.jpg`)).toBe(true);
  });

  it('exits non-zero on a cap error and writes nothing', async () => {
    const h = harness();
    expect(await run(['--out', OUT, '--live', '--max-photos', '1'], h.deps)).toBe(1);
    expect(h.err.join('\n')).toContain('MAX_PHOTOS');
    expect(h.files.size).toBe(0);
    const h2 = harness();
    expect(await run(['--out', OUT, '--live', '--max-bytes', '10'], h2.deps)).toBe(1);
    expect(h2.err.join('\n')).toContain('MAX_BYTES');
  });

  it('refuses --out inside the repo, but accepts the ignored backup-out/ and outside paths', async () => {
    for (const bad of [`${REPO}/docs/b`, REPO, 'docs/b', `${REPO}/backup-out/../src`, '/work']) {
      const h = harness({ fs: throwingFs, fetch: boom as never });
      expect(await run(['--out', bad], h.deps), bad).toBe(2);
      expect(h.err.join('\n')).toContain('--out');
    }
    for (const good of [`${REPO}/backup-out/q1`, 'backup-out/q1', OUT, '/work/repo-backups/a']) {
      const h = harness({ fs: throwingFs, fetch: boom as never });
      expect(await run(['--out', good], h.deps), good).toBe(0);
    }
  });

  it('refuses a non-empty --out with unknown files unless --update', async () => {
    const h = harness({}, ['catalog.json', 'holiday.jpg']);
    expect(await run(['--out', OUT, '--live'], h.deps)).toBe(1);
    expect(h.err.join('\n')).toContain('--update');
    expect(h.err.join('\n')).not.toContain('holiday.jpg');
    expect(h.calls.length).toBe(0);
    const u = harness({}, ['catalog.json', 'holiday.jpg']);
    expect(await run(['--out', OUT, '--live', '--update'], u.deps)).toBe(0);
    // only known entries: fine without --update
    const k = harness({}, ['catalog.json', 'manifest.json', 'masters']);
    expect(await run(['--out', OUT, '--live'], k.deps)).toBe(0);
  });

  it('the written catalog.json passes verifyBackupDocument and restore-plan --check', async () => {
    const h = harness();
    expect(await run(['--out', OUT, '--live'], h.deps)).toBe(0);
    const text = dec.decode(h.files.get(`${OUT}/catalog.json`)!);
    expect(verifyBackupDocument(JSON.parse(text)).ok).toBe(true);
    const lines: string[] = [];
    const errs: string[] = [];
    const code = restorePlan(['--from', `${OUT}/catalog.json`, '--check'], {
      readFile: (p) => dec.decode(h.files.get(p)!),
      writeFile: boom,
      rename: boom,
      exists: () => false,
      log: (l) => lines.push(l),
      error: (l) => errs.push(l),
    });
    expect(code).toBe(0);
    expect(errs).toEqual([]);
    expect(lines).toContain('photos: 2');
    expect(lines).toContain('integrity OK');
  });
});

function memFsWith(files: Map<string, Uint8Array>): BackupFs {
  const m = memFs();
  for (const [k, v] of files) m.files.set(k, v);
  return m.fs;
}
