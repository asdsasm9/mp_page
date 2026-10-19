import type { Snapshot } from '@mp/shared';
import { describe, expect, it, vi } from 'vitest';
import fixtureJson from '../../../../packages/shared/fixtures/snapshot.fixture.json';
import { buildCatalog, CatalogLoadError, loadSnapshot, parseSnapshotText } from './catalog';
import { resolveEnv } from './env';

const SNAP = 'https://img.example.cz/catalog/published.json';
const IMG = 'https://img.example.cz';
const fixture = fixtureJson as unknown as Snapshot;
const clone = (): Snapshot => JSON.parse(JSON.stringify(fixture)) as Snapshot;

const snapshotEnv = resolveEnv({ PUBLIC_SNAPSHOT_URL: SNAP, PUBLIC_IMG_BASE_URL: IMG });
const noSleep = async () => {};
const ok = (body: string) => async () => new Response(body, { status: 200 });

describe('loadSnapshot, fixture mode', () => {
  it('loads the committed fixture without touching the network', async () => {
    const fetchSpy = vi.fn();
    const s = await loadSnapshot(resolveEnv({}), { fetch: fetchSpy as unknown as typeof fetch });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(s.counts).toEqual({ categories: 3, albums: 13, photos: 141 });
  });
});

describe('loadSnapshot, snapshot mode', () => {
  it('succeeds and requests with no-store', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify(fixture), { status: 200 });
    }) as unknown as typeof fetch;
    const s = await loadSnapshot(snapshotEnv, { fetch: f, sleep: noSleep });
    expect(s.generatedAt).toBe(fixture.generatedAt);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe(SNAP);
    expect(calls[0]![1]?.cache).toBe('no-store');
  });

  it('retries a 500 with backoff and then succeeds', async () => {
    let n = 0;
    const sleeps: number[] = [];
    const f = (async () => (++n < 3 ? new Response('x', { status: 500 }) : new Response(JSON.stringify(fixture)))) as unknown as typeof fetch;
    const s = await loadSnapshot(snapshotEnv, { fetch: f, sleep: async (ms) => void sleeps.push(ms) });
    expect(s.counts.albums).toBe(13);
    expect(n).toBe(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it('HTTP 500 on every attempt throws after 3 retries (4 attempts)', async () => {
    const f = vi.fn(async () => new Response('boom', { status: 500 }));
    await expect(loadSnapshot(snapshotEnv, { fetch: f as unknown as typeof fetch, sleep: noSleep })).rejects.toThrow(
      /after 4 attempts: HTTP 500/,
    );
    expect(f).toHaveBeenCalledTimes(4);
  });

  it('a request that never answers times out and throws after 3 retries', async () => {
    const f = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    await expect(
      loadSnapshot(snapshotEnv, { fetch: f as unknown as typeof fetch, sleep: noSleep, timeoutMs: 5 }),
    ).rejects.toThrow(/after 4 attempts: timeout after 5 ms/);
    expect(f).toHaveBeenCalledTimes(4);
  });

  it('a network error is retried and then throws', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(loadSnapshot(snapshotEnv, { fetch: f as unknown as typeof fetch, sleep: noSleep })).rejects.toThrow(
      /network error: fetch failed/,
    );
  });

  it('a 404 is not retried', async () => {
    const f = vi.fn(async () => new Response('nope', { status: 404 }));
    await expect(loadSnapshot(snapshotEnv, { fetch: f as unknown as typeof fetch, sleep: noSleep })).rejects.toThrow(
      /HTTP 404/,
    );
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('invalid JSON throws', async () => {
    await expect(loadSnapshot(snapshotEnv, { fetch: ok('{not json') as unknown as typeof fetch, sleep: noSleep })).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it('a snapshot that fails SnapshotSchema throws', async () => {
    const bad = clone() as unknown as Record<string, unknown>;
    bad.schemaVersion = 2;
    await expect(
      loadSnapshot(snapshotEnv, { fetch: ok(JSON.stringify(bad)) as unknown as typeof fetch, sleep: noSleep }),
    ).rejects.toThrow(/failed validation/);
    // an extra unknown key (strict schema) is also refused
    const extra = { ...clone(), admin: { email: 'a@b.cz' } };
    expect(() => parseSnapshotText(JSON.stringify(extra))).toThrow(CatalogLoadError);
  });

  it('zero albums throws', async () => {
    const empty: Snapshot = { ...clone(), counts: { categories: 1, albums: 0, photos: 0 }, categories: [] };
    empty.categories = [{ ...clone().categories[0]!, albums: [] }];
    await expect(
      loadSnapshot(snapshotEnv, { fetch: ok(JSON.stringify(empty)) as unknown as typeof fetch, sleep: noSleep }),
    ).rejects.toThrow(/SNAPSHOT_EMPTY/);
  });
});

describe('buildCatalog', () => {
  const cat = buildCatalog(fixture);

  it('indexes categories, albums and photos of the fixture', () => {
    expect(cat.categories.map((c) => c.slug)).toEqual(['svatby', 'portrety', 'parove-foceni']);
    expect(cat.albumBySlug.size).toBe(13);
    expect(cat.photoById.size).toBe(141);
    expect(cat.albumBySlug.get('sedlakovi')?.album.photos).toHaveLength(44);
    const any = fixture.categories[0]!.albums[0]!.photos[0]!;
    expect(cat.photoById.get(any.id)?.photo).toBe(any);
  });

  it('gives previous and next album inside the category, null at the ends', () => {
    const list = fixture.categories[0]!.albums;
    expect(cat.neighbours(list[0]!.slug)).toEqual({ prev: null, next: list[1] });
    expect(cat.neighbours(list[1]!.slug)).toEqual({ prev: list[0], next: list[2] });
    expect(cat.neighbours(list[list.length - 1]!.slug).next).toBeNull();
    expect(cat.neighbours('does-not-exist')).toEqual({ prev: null, next: null });
  });

  it('finds covers and falls back to the first photo', () => {
    const album = fixture.categories[0]!.albums[0]!;
    expect(cat.coverOf(album)?.id).toBe(album.coverPhotoId);
    expect(cat.coverOf({ ...album, coverPhotoId: null })?.id).toBe(album.photos[0]!.id);
    expect(cat.coverOf({ ...album, photos: [], coverPhotoId: null })).toBeNull();
    expect(cat.categoryCover(fixture.categories[0]!)?.id).toBe(album.coverPhotoId);
  });

  it('excludes a category with zero albums from the built list', () => {
    const s = clone();
    s.categories.push({ ...clone().categories[0]!, slug: 'prazdna', name: 'Prázdná', albums: [] });
    s.counts.categories = 4;
    const built = buildCatalog(s);
    expect(built.categories.map((c) => c.slug)).not.toContain('prazdna');
    expect(built.categoryBySlug.has('prazdna')).toBe(false);
    expect(built.categories).toHaveLength(3);
  });
});
