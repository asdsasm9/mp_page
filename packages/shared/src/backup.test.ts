import { describe, expect, it } from 'vitest';
import { BackupDocumentSchema, verifyBackupDocument } from './backup';
import type { PhotoVariants } from './variants';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TS = '2026-10-19T12:00:00.000Z';

const variants = (): PhotoVariants => ({
  master: { w: 3000, h: 2000, bytes: 1000 },
  webp: [
    { tier: 480, w: 480, h: 320, bytes: 20 },
    { tier: 960, w: 960, h: 640, bytes: 30 },
  ],
  jpeg: { w: 1600, h: 1067, bytes: 300 },
  og: { w: 1200, h: 630, bytes: 100 },
});

function validDoc(): any {
  const pid = uuid(3);
  return {
    schemaVersion: 1,
    generatedAt: TS,
    categories: [
      {
        id: uuid(1), slug: 'svatby', name: 'Svatby', description: null, seo_title: null, seo_description: null,
        sort: 10, visible: true, created_at: TS, updated_at: TS,
      },
    ],
    albums: [
      {
        id: uuid(2), category_id: uuid(1), slug: 'frankovi', title: 'Frankovi', place: null, shot_on: '2024-06-01',
        description: null, seo_title: null, seo_description: null, cover_photo_id: pid, sort: 10, published: true,
        legacy_id: null, created_at: TS, updated_at: TS,
      },
    ],
    photos: [
      {
        id: pid, album_id: uuid(2), master_key: `photos/${pid}/master.jpg`, width: 3000, height: 2000,
        variants: variants(), bytes_total: 1450, dominant_color: null, alt: null, caption: null, sort: 10,
        legacy_key: null, created_at: TS, updated_at: TS,
      },
    ],
    urlHistory: [{ id: uuid(4), old_path: '/old', target: '/new', status: 301, created_at: TS }],
  };
}

function rejected(doc: unknown, path: string, secret?: string) {
  const v = verifyBackupDocument(doc);
  expect(v.ok).toBe(false);
  if (v.ok) return;
  expect(v.issues.some((i) => i.path === path)).toBe(true);
  const text = JSON.stringify(v.issues);
  if (secret) expect(text).not.toContain(secret);
}

describe('BackupDocumentSchema / verifyBackupDocument', () => {
  it('accepts a valid document', () => {
    const v = verifyBackupDocument(validDoc());
    expect(v.ok).toBe(true);
    expect(BackupDocumentSchema.safeParse(validDoc()).success).toBe(true);
  });

  it('accepts an empty catalog', () => {
    const d = validDoc();
    d.categories = [];
    d.albums = [];
    d.photos = [];
    d.urlHistory = [];
    expect(verifyBackupDocument(d).ok).toBe(true);
  });

  it('rejects an orphan album', () => {
    const d = validDoc();
    d.albums[0].category_id = uuid(99);
    rejected(d, 'albums.0.category_id', uuid(99));
  });

  it('rejects an orphan photo', () => {
    const d = validDoc();
    d.photos[0].album_id = uuid(98);
    rejected(d, 'photos.0.album_id', uuid(98));
  });

  it('rejects a cover that is not a photo', () => {
    const d = validDoc();
    d.albums[0].cover_photo_id = uuid(97);
    rejected(d, 'albums.0.cover_photo_id', uuid(97));
  });

  it('rejects a wrong master_key', () => {
    const d = validDoc();
    d.photos[0].master_key = 'photos/secret-value/master.jpg';
    rejected(d, 'photos.0.master_key', 'secret-value');
  });

  it('rejects a duplicate slug (categories and albums)', () => {
    const d = validDoc();
    d.albums.push({ ...d.albums[0], id: uuid(5), cover_photo_id: null });
    rejected(d, 'albums.1.slug');
    const e = validDoc();
    e.categories.push({ ...e.categories[0], id: uuid(6) });
    rejected(e, 'categories.1.slug');
  });

  it('rejects invalid variants', () => {
    const d = validDoc();
    d.photos[0].variants.webp = [];
    rejected(d, 'photos.0.variants.webp');
    const e = validDoc();
    e.photos[0].variants.extra = 1;
    rejected(e, 'photos.0.variants');
  });

  it('rejects a bytes_total that is not the variant sum', () => {
    const d = validDoc();
    d.photos[0].bytes_total = 1451;
    rejected(d, 'photos.0.bytes_total');
  });

  it('rejects unknown keys at every level without echoing them', () => {
    const d = validDoc();
    d.surprise = 1;
    rejected(d, '(root)', 'surprise');
    const e = validDoc();
    e.photos[0].hunter2 = 'x';
    rejected(e, 'photos.0', 'hunter2');
  });

  it('rejects duplicate ids, wrong schemaVersion and non-objects', () => {
    const d = validDoc();
    d.categories.push({ ...d.categories[0], slug: 'other' });
    rejected(d, 'categories.1.id');
    const e = validDoc();
    e.schemaVersion = 2;
    rejected(e, 'schemaVersion');
    expect(verifyBackupDocument(null).ok).toBe(false);
    expect(verifyBackupDocument('x').ok).toBe(false);
  });
});
