// Backup core against FAKES only: fake Supabase, fake image host, in-memory fs. No network, no disk, no .env.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { masterKey } from '../../packages/shared/src';
import type { FetchLike } from '../migrate-legacy/http-backend';
import { BackupError, readCatalog } from './catalog';
import { backupMasters, CapError, type BackupFs } from './masters';
import { runBackup } from './run';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TS = '2026-10-19T12:00:00.000Z';
const SUPA = 'https://abcdefgh.supabase.co';
const IMG = 'https://img.example.test';
const ADMIN_ID = uuid(900);
const OUT = '/backup-out';
const IDS = [uuid(11), uuid(12), uuid(13)];

// Fake secrets are assembled at runtime so no literal secret sits in the source.
const rnd = () => Math.random().toString(36).slice(2, 10);
const PASSWORD = ['pw', rnd(), 'x9'].join('-');
const JWT = ['jwt', rnd(), 'y7'].join('.');
const ANON = ['anon', rnd(), 'z5'].join('_');
const EMAIL = `admin-${rnd()}@example.test`;
const SECRETS = [PASSWORD, JWT, ANON, EMAIL];

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const bytesFor = (id: string) => new TextEncoder().encode(`JPEGDATA:${id}:${'x'.repeat(50)}`);

function catalogRows() {
  const variants = {
    master: { w: 3000, h: 2000, bytes: 1000 },
    webp: [{ tier: 480, w: 480, h: 320, bytes: 20 }, { tier: 960, w: 960, h: 640, bytes: 30 }],
    jpeg: { w: 1600, h: 1067, bytes: 300 },
    og: { w: 1200, h: 630, bytes: 100 },
  };
  return {
    categories: [{ id: uuid(1), slug: 'svatby', name: 'Svatby', description: null, seo_title: null, seo_description: null, sort: 10, visible: true, created_at: TS, updated_at: TS }],
    albums: [{ id: uuid(2), category_id: uuid(1), slug: 'frankovi', title: 'Frankovi', place: null, shot_on: '2024-06-01', description: null, seo_title: null, seo_description: null, cover_photo_id: IDS[0], sort: 10, published: true, legacy_id: null, created_at: TS, updated_at: TS }],
    photos: IDS.map((id, i) => ({ id, album_id: uuid(2), master_key: masterKey(id), width: 3000, height: 2000, variants, bytes_total: 1450, dominant_color: null, alt: null, caption: null, sort: i, legacy_key: null, created_at: TS, updated_at: TS })),
    url_history: [{ id: uuid(4), old_path: '/old', target: '/new', status: 301, created_at: TS }],
  };
}

function memFs() {
  const files = new Map<string, Uint8Array>();
  const fs: BackupFs = {
    async mkdir() {},
    async readFile(p) {
      return files.get(p) ?? null;
    },
    async writeFile(p, d) {
      files.set(p, d);
    },
    async rename(a, b) {
      const d = files.get(a);
      if (!d) throw new Error('ENOENT');
      files.set(b, d);
      files.delete(a);
    },
    async rm(p) {
      files.delete(p);
    },
  };
  return { files, fs };
}

interface Call { method: string; url: string }

interface World {
  calls: Call[];
  imageCalls: Call[];
  fetch: FetchLike;
  statuses: Map<string, number[]>; // per photo id: queued statuses before success
  redirects: Map<string, string>;
  maxInFlight: () => number;
}

function world(opts: { isAdmin?: boolean; rows?: ReturnType<typeof catalogRows>; body?: (id: string) => Uint8Array; delayMs?: number } = {}): World {
  const rows = opts.rows ?? catalogRows();
  const calls: Call[] = [];
  const imageCalls: Call[] = [];
  const statuses = new Map<string, number[]>();
  const redirects = new Map<string, string>();
  let inFlight = 0;
  let peak = 0;
  const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url });
    if (url.startsWith(IMG)) {
      imageCalls.push({ method, url });
      inFlight++;
      peak = Math.max(peak, inFlight);
      try {
        await new Promise((r) => setTimeout(r, opts.delayMs ?? 0));
        const m = /photos\/([^/]+)\/master\.jpg$/.exec(url);
        const id = m?.[1] ?? '';
        const red = redirects.get(id);
        if (red) return new Response(null, { status: 302, headers: { location: red } });
        const q = statuses.get(id);
        const next = q?.shift();
        if (next !== undefined) return new Response('no', { status: next });
        if (!IDS.includes(id)) return new Response('no', { status: 404 });
        const body = (opts.body ?? bytesFor)(id);
        return new Response(body as unknown as BodyInit, { status: 200, headers: { 'content-length': String(body.byteLength) } });
      } finally {
        inFlight--;
      }
    }
    if (url.includes('/auth/v1/token')) return j({ access_token: JWT, user: { id: ADMIN_ID } });
    if (url.includes('/auth/v1/user')) return j({ id: ADMIN_ID });
    const u = new URL(url);
    const table = u.pathname.replace('/rest/v1/', '');
    if (table === 'admins') return j(opts.isAdmin === false ? [] : [{ user_id: ADMIN_ID }]);
    if (table in rows) {
      const all = (rows as Record<string, unknown[]>)[table]!;
      const off = Number(u.searchParams.get('offset') ?? 0);
      const lim = Number(u.searchParams.get('limit') ?? 1000);
      return j(all.slice(off, off + lim));
    }
    return j({ error: 'x' }, 404);
  };
  return { calls, imageCalls, fetch, statuses, redirects, maxInFlight: () => peak };
}

const creds = { email: EMAIL, password: PASSWORD };
const base = (w: World, fs: BackupFs, extra: Partial<Parameters<typeof runBackup>[0]> = {}): Parameters<typeof runBackup>[0] => ({
  catalog: { supabaseUrl: SUPA, anonKey: ANON, credentials: creds },
  imgBaseUrl: IMG,
  outDir: OUT,
  fs,
  fetch: w.fetch,
  sleep: async () => {},
  now: () => new Date(TS),
  maxPhotos: 100,
  maxBytes: 1_000_000,
  ...extra,
});

describe('catalog reader', () => {
  it('returns a verified BackupDocument, paged', async () => {
    const w = world();
    const doc = await readCatalog({ supabaseUrl: SUPA, anonKey: ANON, credentials: creds, fetch: w.fetch, pageSize: 2, now: () => new Date(TS) });
    expect(doc.schemaVersion).toBe(1);
    expect(doc.generatedAt).toBe(TS);
    expect([doc.categories.length, doc.albums.length, doc.photos.length, doc.urlHistory.length]).toEqual([1, 1, 3, 1]);
    // 3 photos with page size 2 take two requests
    expect(w.calls.filter((c) => c.url.includes('/rest/v1/photos')).length).toBe(2);
  });

  it('only GET, plus the one sign-in POST (none with an access token)', async () => {
    const w = world();
    await readCatalog({ supabaseUrl: SUPA, anonKey: ANON, credentials: creds, fetch: w.fetch });
    const nonGet = w.calls.filter((c) => c.method !== 'GET');
    expect(nonGet.length).toBe(1);
    expect(nonGet[0]!.url).toContain('/auth/v1/token');
    const w2 = world();
    await readCatalog({ supabaseUrl: SUPA, anonKey: ANON, credentials: { accessToken: JWT }, fetch: w2.fetch });
    expect(w2.calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('refuses a non-admin and reads no table', async () => {
    const w = world({ isAdmin: false });
    await expect(readCatalog({ supabaseUrl: SUPA, anonKey: ANON, credentials: creds, fetch: w.fetch })).rejects.toMatchObject({ code: 'NOT_ADMIN' });
    expect(w.calls.some((c) => c.url.includes('/rest/v1/photos'))).toBe(false);
  });

  it('rejects an inconsistent catalog without echoing values', async () => {
    const rows = catalogRows();
    rows.albums[0]!.category_id = uuid(777);
    const w = world({ rows });
    const err = await readCatalog({ supabaseUrl: SUPA, anonKey: ANON, credentials: creds, fetch: w.fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(BackupError);
    expect(err.code).toBe('INVALID_DOCUMENT');
    expect(err.message).toContain('albums.0.category_id');
    expect(err.message).not.toContain(uuid(777));
  });
});

describe('backup run', () => {
  it('first run writes catalog, masters and manifest', async () => {
    const w = world();
    const { files, fs } = memFs();
    const res = await runBackup(base(w, fs));
    expect(res.masters.written).toBe(3);
    expect(res.failed).toEqual([]);
    for (const id of IDS) expect(files.get(`${OUT}/masters/${id}.jpg`)).toEqual(bytesFor(id));
    const manifest = JSON.parse(new TextDecoder().decode(files.get(`${OUT}/manifest.json`)!));
    expect(manifest.entries.map((e: { id: string }) => e.id)).toEqual(IDS);
    expect(manifest.entries[0]).toEqual({ id: IDS[0], bytes: bytesFor(IDS[0]!).byteLength, sha256: sha(bytesFor(IDS[0]!)), source: masterKey(IDS[0]!), fetchedAt: TS });
    const cat = JSON.parse(new TextDecoder().decode(files.get(`${OUT}/catalog.json`)!));
    expect(cat.photos.length).toBe(3);
    expect(cat.urlHistory.length).toBe(1);
    expect([...files.keys()].some((k) => k.endsWith('.part'))).toBe(false);
  });

  it('a rerun fetches and changes nothing', async () => {
    const w = world();
    const { files, fs } = memFs();
    await runBackup(base(w, fs));
    const before = new Map([...files].map(([k, v]) => [k, sha(v)]));
    const w2 = world();
    const res = await runBackup(base(w2, fs));
    expect(res.masters.written).toBe(0);
    expect(res.masters.skipped).toBe(3);
    expect(w2.imageCalls.length).toBe(0);
    expect(new Map([...files].map(([k, v]) => [k, sha(v)]))).toEqual(before);
  });

  it('re-fetches a corrupted or truncated file', async () => {
    const w = world();
    const { files, fs } = memFs();
    await runBackup(base(w, fs));
    const p0 = `${OUT}/masters/${IDS[0]}.jpg`;
    const p1 = `${OUT}/masters/${IDS[1]}.jpg`;
    const good0 = files.get(p0)!;
    const flipped = new Uint8Array(good0);
    flipped[0] = flipped[0]! ^ 0xff; // same size, different bytes
    files.set(p0, flipped);
    files.set(p1, files.get(p1)!.slice(0, 10)); // partial
    const w2 = world();
    const res = await runBackup(base(w2, fs));
    expect(res.masters.written).toBe(2);
    expect(res.masters.skipped).toBe(1);
    expect(files.get(p0)).toEqual(good0);
    expect(files.get(p1)).toEqual(bytesFor(IDS[1]!));
    expect(w2.imageCalls.length).toBe(2);
  });

  it('reports a 404 and still writes the others', async () => {
    const w = world();
    w.statuses.set(IDS[1]!, [404]);
    const { files, fs } = memFs();
    const res = await runBackup(base(w, fs));
    expect(res.failed).toEqual([{ id: IDS[1], code: 'NOT_FOUND', status: 404 }]);
    expect(res.masters.written).toBe(2);
    expect(files.has(`${OUT}/masters/${IDS[0]}.jpg`)).toBe(true);
    expect(files.has(`${OUT}/masters/${IDS[1]}.jpg`)).toBe(false);
    expect(files.has(`${OUT}/masters/${IDS[2]}.jpg`)).toBe(true);
    const manifest = JSON.parse(new TextDecoder().decode(files.get(`${OUT}/manifest.json`)!));
    expect(manifest.entries.length).toBe(2);
  });

  it('refuses over the photo cap and over the byte cap before fetching or writing', async () => {
    for (const [cap, code] of [[{ maxPhotos: 2 }, 'MAX_PHOTOS'], [{ maxBytes: 2999 }, 'MAX_BYTES']] as const) {
      const w = world();
      const { files, fs } = memFs();
      const err = await runBackup(base(w, fs, cap)).catch((e) => e);
      expect(err).toBeInstanceOf(CapError);
      expect(err.code).toBe(code);
      expect(w.imageCalls.length).toBe(0);
      expect(files.size).toBe(0);
    }
  });

  it('aborts a response over the declared per-file cap and one that streams past it', async () => {
    const big = new Uint8Array(500);
    const w = world({ body: () => big });
    const { files, fs } = memFs();
    const res = await backupMasters({ imgBaseUrl: IMG, outDir: OUT, items: [{ id: IDS[0]! }], fs, fetch: w.fetch, maxPhotos: 5, maxBytes: 10_000, maxFileBytes: 100 });
    expect(res.failed).toEqual([{ id: IDS[0], code: 'TOO_LARGE' }]);
    expect(files.has(`${OUT}/masters/${IDS[0]}.jpg`)).toBe(false);
    // no content-length header: the stream itself is cut off
    const streaming: FetchLike = async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(80)); c.enqueue(new Uint8Array(80)); c.close(); } }), { status: 200 });
    const res2 = await backupMasters({ imgBaseUrl: IMG, outDir: OUT, items: [{ id: IDS[0]! }], fs, fetch: streaming, maxPhotos: 5, maxBytes: 10_000, maxFileBytes: 100 });
    expect(res2.failed[0]?.code).toBe('TOO_LARGE');
  });

  it('fetches exactly PUBLIC_IMG_BASE_URL + masterKey(id), with GET only', async () => {
    const w = world();
    const { fs } = memFs();
    await runBackup(base(w, fs, { imgBaseUrl: `${IMG}/` }));
    expect(w.imageCalls.map((c) => c.url).sort()).toEqual(IDS.map((id) => IMG + '/' + masterKey(id)).sort());
    expect(w.imageCalls.every((c) => c.method === 'GET')).toBe(true);
    const nonGet = w.calls.filter((c) => c.method !== 'GET');
    expect(nonGet.map((c) => c.url)).toEqual([`${SUPA}/auth/v1/token?grant_type=password`]);
  });

  it('rejects ids that are not UUIDs before any request', async () => {
    const w = world();
    const { files, fs } = memFs();
    const res = await backupMasters({
      imgBaseUrl: IMG, outDir: OUT, fs, fetch: w.fetch, maxPhotos: 10, maxBytes: 1000,
      items: [{ id: '../x' }, { id: 'photos/../../etc' }, { id: 'AAAAAAAA-0000-4000-8000-000000000001' }, { id: '' }],
    });
    expect(w.calls.length).toBe(0);
    expect(res.failed.length).toBe(4);
    expect(res.failed.every((f) => f.code === 'INVALID_ID' && f.id === '(invalid)')).toBe(true);
    expect([...files.keys()]).toEqual([`${OUT}/manifest.json`]);
  });

  it('refuses a redirect to another host, follows one on the same host', async () => {
    const w = world();
    w.redirects.set(IDS[0]!, 'https://evil.example.test/steal.jpg');
    const { fs } = memFs();
    const res = await backupMasters({ imgBaseUrl: IMG, outDir: OUT, items: [{ id: IDS[0]! }], fs, fetch: w.fetch, maxPhotos: 5, maxBytes: 10_000 });
    expect(res.failed).toEqual([{ id: IDS[0], code: 'REDIRECT_OFF_HOST' }]);
    expect(w.calls.some((c) => c.url.includes('evil.example.test'))).toBe(false);

    let hops = 0;
    const same: FetchLike = async (url) => {
      if (hops++ === 0) return new Response(null, { status: 301, headers: { location: `/photos/${IDS[0]}/master.jpg?x=1` } });
      expect(url.startsWith(IMG + '/')).toBe(true);
      return new Response(bytesFor(IDS[0]!), { status: 200 });
    };
    const ok = await backupMasters({ imgBaseUrl: IMG, outDir: OUT, items: [{ id: IDS[0]! }], fs, fetch: same, maxPhotos: 5, maxBytes: 10_000 });
    expect(ok.written).toBe(1);
  });

  it('retries 429 and 5xx a bounded number of times with a delay', async () => {
    const w = world();
    w.statuses.set(IDS[0]!, [503, 429]);
    w.statuses.set(IDS[1]!, [500, 500, 500, 500, 500, 500, 500]);
    const sleeps: number[] = [];
    const { fs } = memFs();
    const res = await backupMasters({
      imgBaseUrl: IMG, outDir: OUT, fs, fetch: w.fetch, maxPhotos: 5, maxBytes: 10_000, retries: 3, retryDelayMs: 10,
      sleep: async (ms) => { sleeps.push(ms); }, items: [{ id: IDS[0]! }, { id: IDS[1]! }],
    });
    expect(res.written).toBe(1);
    expect(res.failed).toEqual([{ id: IDS[1], code: 'HTTP_ERROR', status: 500 }]);
    expect(w.imageCalls.filter((c) => c.url.includes(IDS[1]!)).length).toBe(4); // 1 try + 3 retries
    expect(sleeps.length).toBe(2 + 3);
    expect(sleeps.every((s) => s > 0)).toBe(true);
  });

  it('never runs more than four downloads at once', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => uuid(100 + i));
    const calls: string[] = [];
    let inFlight = 0;
    let peak = 0;
    const f: FetchLike = async (url) => {
      calls.push(url);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return new Response(new Uint8Array(3), { status: 200 });
    };
    const { fs } = memFs();
    const res = await backupMasters({ imgBaseUrl: IMG, outDir: OUT, items: ids.map((id) => ({ id })), fs, fetch: f, maxPhotos: 50, maxBytes: 1000, concurrency: 99 });
    expect(res.written).toBe(12);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('keeps manifest entries of photos that left the catalog', async () => {
    const w = world();
    const { files, fs } = memFs();
    await runBackup(base(w, fs));
    const rows = catalogRows();
    rows.photos = rows.photos.slice(0, 2);
    const res = await runBackup(base(world({ rows }), fs));
    expect(res.masters.manifest.entries.length).toBe(3);
    expect(files.has(`${OUT}/masters/${IDS[2]}.jpg`)).toBe(true);
  });

  it('never leaks secrets into any written file, result, manifest or error', async () => {
    const w = world();
    w.statuses.set(IDS[1]!, [404]);
    const { files, fs } = memFs();
    const res = await runBackup(base(w, fs));
    const haystack = [
      JSON.stringify(res),
      ...[...files.entries()].map(([k, v]) => k + new TextDecoder('latin1').decode(v)),
    ].join('\n');
    for (const s of SECRETS) expect(haystack).not.toContain(s);
    // error paths
    const bad = world({ isAdmin: false });
    const e1 = await runBackup(base(bad, memFs().fs)).catch((e) => e);
    const e2 = await runBackup(base(world(), memFs().fs, { catalog: { supabaseUrl: SUPA, anonKey: ANON, credentials: creds }, fetch: async () => { throw new Error(`boom ${PASSWORD} ${JWT}`); } })).catch((e) => e);
    for (const e of [e1, e2]) for (const s of SECRETS) expect(`${e.message}${e.stack?.split('\n')[0]}`).not.toContain(s);
    // the bearer token went only to the Supabase host, never to the image host
    expect(w.imageCalls.length).toBeGreaterThan(0);
  });

  it('sends no credentials to the image host', async () => {
    const seen: Array<Record<string, string>> = [];
    const w = world();
    const wrapped: FetchLike = async (url, init) => {
      if (url.startsWith(IMG)) seen.push(Object.fromEntries(Object.entries((init?.headers as Record<string, string> | undefined) ?? {})));
      return w.fetch(url, init);
    };
    await runBackup(base(w, memFs().fs, { fetch: wrapped }));
    expect(seen.length).toBe(3);
    expect(seen.every((h) => Object.keys(h).length === 0)).toBe(true);
  });
});
