import { describe, expect, it } from 'vitest';
import type { AlbumRow, CategoryRow, PhotoRow, UrlHistoryRow } from './db';
import { SnapshotEmptyError, SnapshotSchema, assertPublishable, buildSnapshot, type Snapshot } from './snapshot';
import type { PhotoVariants } from './variants';

const variants: PhotoVariants = {
  master: { w: 3000, h: 2000, bytes: 1_000_000 },
  webp: [{ tier: 480, w: 480, h: 320, bytes: 20_000 }],
  jpeg: { w: 1600, h: 1067, bytes: 300_000 },
  og: { w: 1200, h: 630, bytes: 100_000 },
};
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TS = '2026-10-19T12:00:00.000Z';

function cat(n: number, over: Partial<CategoryRow> = {}): CategoryRow {
  return {
    id: uuid(100 + n), slug: `cat-${n}`, name: `Category ${n}`, description: null,
    seo_title: null, seo_description: null, sort: n * 10, visible: true, created_at: TS, updated_at: TS,
    ...over,
  };
}
function album(n: number, categoryId: string, over: Partial<AlbumRow> = {}): AlbumRow {
  return {
    id: uuid(200 + n), category_id: categoryId, slug: `album-${n}`, title: `Album ${n}`, place: null,
    shot_on: null, description: null, seo_title: null, seo_description: null, cover_photo_id: null,
    sort: n * 10, published: true, legacy_id: null, created_at: TS, updated_at: TS,
    ...over,
  };
}
function photo(n: number, albumId: string, over: Partial<PhotoRow> = {}): PhotoRow {
  const id = uuid(300 + n);
  return {
    id, album_id: albumId, master_key: `photos/${id}/master.jpg`, width: 3000, height: 2000, variants,
    bytes_total: 1_420_000, dominant_color: null, alt: null, caption: null, sort: n * 10, legacy_key: null,
    created_at: TS, updated_at: TS,
    ...over,
  };
}

const NOW = new Date('2026-10-19T12:00:00Z');
const c1 = cat(1);
const a1 = album(1, c1.id);

describe('SnapshotSchema', () => {
  const valid = (): Snapshot => ({
    schemaVersion: 1,
    generatedAt: TS,
    counts: { categories: 1, albums: 1, photos: 1 },
    categories: [
      {
        slug: 'svatby', name: 'Svatby', description: null, seoTitle: null, seoDescription: null,
        albums: [
          {
            slug: 'frankovi', title: 'Michal & Rozárka', place: null, shotOn: '2024-06-01', description: null,
            seoTitle: null, seoDescription: null, coverPhotoId: uuid(1), legacyId: 'frankovi',
            photos: [{ id: uuid(1), width: 3000, height: 2000, alt: null, caption: null, dominantColor: '#aabbcc', variants }],
          },
        ],
      },
    ],
    redirects: [{ from: '/svatby/old/', to: '/svatby/frankovi/', status: 301 }],
  });
  const messages = (v: unknown) => {
    const r = SnapshotSchema.safeParse(v);
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };

  it('accepts a hand-written valid sample', () => {
    expect(SnapshotSchema.safeParse(valid()).success).toBe(true);
  });
  it('rejects a duplicate album slug across categories', () => {
    const s = valid();
    s.categories.push({ ...(JSON.parse(JSON.stringify(s.categories[0])) as Snapshot['categories'][number]), slug: 'portrety', name: 'Portréty' });
    s.categories[1]!.albums[0]!.photos[0]!.id = uuid(2);
    s.categories[1]!.albums[0]!.coverPhotoId = uuid(2);
    s.counts = { categories: 2, albums: 2, photos: 2 };
    expect(messages(s).join('\n')).toContain('duplicate album slug "frankovi"');
  });
  it('rejects a cover that is not in the album', () => {
    const s = valid();
    s.categories[0]!.albums[0]!.coverPhotoId = uuid(99);
    expect(messages(s).join('\n')).toContain('is not a photo of album');
  });
  it('rejects a null cover on an album with photos', () => {
    const s = valid();
    s.categories[0]!.albums[0]!.coverPhotoId = null;
    expect(messages(s).join('\n')).toContain('may only be null');
  });
  it('rejects wrong counts', () => {
    const s = valid();
    s.counts.photos = 5;
    expect(messages(s).join('\n')).toContain('counts.photos is 5 but the snapshot has 1');
  });
  it('rejects schemaVersion 2', () => {
    const s = { ...valid(), schemaVersion: 2 };
    expect(SnapshotSchema.safeParse(s).success).toBe(false);
  });
  it('rejects an album with no title', () => {
    const s = valid();
    s.categories[0]!.albums[0]!.title = '';
    expect(messages(s).join('\n')).toContain('album title is required');
  });
  it('rejects unknown extra keys at every level', () => {
    expect(SnapshotSchema.safeParse({ ...valid(), extra: 1 }).success).toBe(false);
    const s = valid();
    (s.categories[0]!.albums[0]! as Record<string, unknown>).email = 'a@b.cz';
    expect(SnapshotSchema.safeParse(s).success).toBe(false);
  });
  it('rejects duplicate photo ids and a 301 without a target', () => {
    const s = valid();
    s.categories[0]!.albums[0]!.photos.push({ ...s.categories[0]!.albums[0]!.photos[0]! });
    s.counts.photos = 2;
    expect(messages(s).join('\n')).toContain('duplicate photo id');
    const r = valid();
    r.redirects = [{ from: '/x/', to: null, status: 301 }];
    expect(SnapshotSchema.safeParse(r).success).toBe(false);
    r.redirects = [{ from: '/x/', to: null, status: 410 }];
    expect(SnapshotSchema.safeParse(r).success).toBe(true);
  });
});

describe('assertPublishable', () => {
  it('throws SNAPSHOT_EMPTY for zero albums', () => {
    const empty = buildSnapshot({ categories: [c1], albums: [], photos: [], urlHistory: [] }, NOW);
    expect(() => assertPublishable(empty)).toThrow(SnapshotEmptyError);
    expect(() => assertPublishable(empty)).toThrow('SNAPSHOT_EMPTY');
  });
  it('passes with one album', () => {
    const s = buildSnapshot({ categories: [c1], albums: [a1], photos: [photo(1, a1.id)], urlHistory: [] }, NOW);
    expect(() => assertPublishable(s)).not.toThrow();
  });
});

describe('buildSnapshot', () => {
  it('excludes hidden categories, unpublished albums and albums inside hidden categories', () => {
    const hidden = cat(2, { visible: false });
    const draft = album(2, c1.id, { published: false });
    const inHidden = album(3, hidden.id);
    const s = buildSnapshot(
      {
        categories: [c1, hidden],
        albums: [a1, draft, inHidden],
        photos: [photo(1, a1.id), photo(2, draft.id), photo(3, inHidden.id)],
        urlHistory: [],
      },
      NOW,
    );
    expect(s.categories.map((c) => c.slug)).toEqual(['cat-1']);
    expect(s.categories[0]!.albums.map((a) => a.slug)).toEqual(['album-1']);
    expect(s.counts).toEqual({ categories: 1, albums: 1, photos: 1 });
    expect(JSON.stringify(s)).not.toContain(draft.id);
  });
  it('orders by sort then id', () => {
    const cB = cat(2, { sort: 5 });
    const a2 = album(2, c1.id, { sort: 10 }); // ties with a1 on sort, larger id
    const p1 = photo(1, a1.id, { sort: 30 });
    const p2 = photo(2, a1.id, { sort: 10 });
    const p3 = photo(3, a1.id, { sort: 10 });
    const s = buildSnapshot(
      { categories: [c1, cB], albums: [a2, a1], photos: [p1, p3, p2], urlHistory: [] },
      NOW,
    );
    expect(s.categories.map((c) => c.slug)).toEqual(['cat-2', 'cat-1']);
    expect(s.categories[1]!.albums.map((a) => a.slug)).toEqual(['album-1', 'album-2']);
    expect(s.categories[1]!.albums[0]!.photos.map((p) => p.id)).toEqual([p2.id, p3.id, p1.id]);
  });
  it('keeps a valid cover, falls back to the lowest-sort photo, null for an empty album', () => {
    const p1 = photo(1, a1.id, { sort: 20 });
    const p2 = photo(2, a1.id, { sort: 10 });
    const withCover = album(2, c1.id, { cover_photo_id: photo(9, 'x').id });
    const other = photo(9, withCover.id, { sort: 5 });
    const stale = album(3, c1.id, { cover_photo_id: p1.id }); // points at a photo of another album
    const stalePhoto = photo(4, stale.id, { sort: 1 });
    const empty = album(4, c1.id);
    const s = buildSnapshot(
      {
        categories: [c1],
        albums: [a1, withCover, stale, empty],
        photos: [p1, p2, other, stalePhoto],
        urlHistory: [],
      },
      NOW,
    );
    const by = (slug: string) => s.categories[0]!.albums.find((a) => a.slug === slug)!;
    expect(by('album-1').coverPhotoId).toBe(p2.id); // no cover set -> lowest sort
    expect(by('album-2').coverPhotoId).toBe(other.id);
    expect(by('album-3').coverPhotoId).toBe(stalePhoto.id);
    expect(by('album-4').coverPhotoId).toBeNull();
    expect(by('album-4').photos).toEqual([]);
  });
  it('maps url_history to redirects and trims shot_on to a date', () => {
    const rows: UrlHistoryRow[] = [
      { id: uuid(2), old_path: '/b/', target: null, status: 410, created_at: TS },
      { id: uuid(1), old_path: '/a/', target: '/z/', status: 301, created_at: TS },
    ];
    const a = album(1, c1.id, { shot_on: '2024-06-01T00:00:00.000Z' });
    const s = buildSnapshot({ categories: [c1], albums: [a], photos: [], urlHistory: rows }, NOW);
    expect(s.redirects).toEqual([
      { from: '/a/', to: '/z/', status: 301 },
      { from: '/b/', to: null, status: 410 },
    ]);
    expect(s.categories[0]!.albums[0]!.shotOn).toBe('2024-06-01');
  });
  it('output always passes the schema and carries generatedAt', () => {
    const s = buildSnapshot({ categories: [c1], albums: [a1], photos: [photo(1, a1.id)], urlHistory: [] }, NOW);
    expect(SnapshotSchema.safeParse(s).success).toBe(true);
    expect(s.generatedAt).toBe('2026-10-19T12:00:00.000Z');
    expect(s.schemaVersion).toBe(1);
  });
});
