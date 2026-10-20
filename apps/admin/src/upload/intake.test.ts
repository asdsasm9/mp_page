import { describe, expect, it } from 'vitest';
import { cs } from '../i18n/cs';
import { fingerprint, intakeFiles, isSupportedType, naturalCompare, sortNatural } from './intake';
import { initialQueueState, queueReducer, summarize } from './reducer';
import type { FileLike } from './types';

const file = (name: string, size = 1000, type = 'image/jpeg'): FileLike => ({ name, size, type, lastModified: 0 });
const limits = { maxUploadBytes: 40_000 };
const ALBUM = 'bbbbbbbb-0000-4000-8000-000000000001';

describe('natural sort', () => {
  it('orders numbers by value, case-insensitively and stably', () => {
    const names = ['IMG_10.jpg', 'img_2.jpg', 'IMG_1.jpg', 'IMG_100.jpg', 'b.jpg', 'A.jpg'];
    expect(sortNatural(names.map((name) => ({ name }))).map((f) => f.name)).toEqual([
      'A.jpg',
      'b.jpg',
      'IMG_1.jpg',
      'img_2.jpg',
      'IMG_10.jpg',
      'IMG_100.jpg',
    ]);
    expect(naturalCompare('a', 'a')).toBe(0);
    expect(naturalCompare('a2', 'a10')).toBeLessThan(0);
    expect(naturalCompare('a', 'a1')).toBeLessThan(0);
  });

  it('keeps the original order of equal names', () => {
    const items = [
      { name: 'x.jpg', n: 1 },
      { name: 'x.jpg', n: 2 },
    ];
    expect(sortNatural(items).map((i) => i.n)).toEqual([1, 2]);
  });
});

describe('type and size', () => {
  it('accepts JPEG, PNG, WebP and HEIC by MIME type', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) {
      expect(isSupportedType({ name: 'x', type })).toBe(true);
    }
  });

  it('falls back to the extension when the browser reports no type (HEIC)', () => {
    expect(isSupportedType({ name: 'IMG_0001.HEIC', type: '' })).toBe(true);
    expect(isSupportedType({ name: 'IMG_0001.heic', type: 'application/octet-stream' })).toBe(true);
    expect(isSupportedType({ name: 'notes.txt', type: '' })).toBe(false);
    expect(isSupportedType({ name: 'noext', type: '' })).toBe(false);
  });

  it('rejects other types even with an image extension', () => {
    expect(isSupportedType({ name: 'a.jpg', type: 'image/gif' })).toBe(false);
    expect(isSupportedType({ name: 'a.jpg', type: 'application/pdf' })).toBe(false);
  });

  it('exact messages: unsupported format, file too large; the limit itself is allowed', () => {
    const result = intakeFiles([file('a.gif', 10, 'image/gif'), file('big.jpg', 40_001), file('edge.jpg', 40_000)], {
      albumId: ALBUM,
      limits,
    });
    expect(result.rejected.map((r) => [r.file.name, r.reason, r.message])).toEqual([
      ['a.gif', 'type', 'Nepodporovaný formát (JPEG, PNG, HEIC, WebP).'],
      ['big.jpg', 'size', 'Soubor je příliš velký.'],
    ]);
    expect(cs.upload.unsupported).toBe('Nepodporovaný formát (JPEG, PNG, HEIC, WebP).');
    expect(result.accepted.map((f) => f.name)).toEqual(['edge.jpg']);
  });

  it('follows the configured limit', () => {
    const big = file('x.jpg', 5_000);
    expect(intakeFiles([big], { albumId: ALBUM, limits: { maxUploadBytes: 4_000 } }).rejected).toHaveLength(1);
    expect(intakeFiles([big], { albumId: ALBUM, limits: { maxUploadBytes: 5_000 } }).accepted).toHaveLength(1);
  });
});

describe('duplicates (session only)', () => {
  it('same album, name and size is a duplicate; another album or size is not', () => {
    const known = new Set([fingerprint(ALBUM, file('IMG_1.jpg', 1000))]);
    const picked = [file('IMG_1.jpg', 1000), file('IMG_1.jpg', 1001), file('IMG_2.jpg', 1000)];
    const result = intakeFiles(picked, { albumId: ALBUM, limits, known });
    expect(result.duplicates.map((f) => f.name)).toEqual(['IMG_1.jpg']);
    expect(result.accepted.map((f) => [f.name, f.size])).toEqual([
      ['IMG_1.jpg', 1001],
      ['IMG_2.jpg', 1000],
    ]);
    const other = intakeFiles(picked, { albumId: 'cccccccc-0000-4000-8000-000000000001', limits, known });
    expect(other.duplicates).toEqual([]);
  });

  it('the same file twice in one pick is queued once', () => {
    const result = intakeFiles([file('a.jpg'), file('a.jpg')], { albumId: ALBUM, limits });
    expect(result.accepted).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
  });

  it('returns the accepted files in natural order', () => {
    const result = intakeFiles([file('IMG_10.jpg'), file('IMG_9.jpg'), file('IMG_1.jpg')], { albumId: ALBUM, limits });
    expect(result.accepted.map((f) => f.name)).toEqual(['IMG_1.jpg', 'IMG_9.jpg', 'IMG_10.jpg']);
  });
});

describe('queue reducer', () => {
  const add = () =>
    queueReducer(initialQueueState, {
      type: 'add',
      items: [
        { id: 'a', albumId: ALBUM, name: 'a.jpg', size: 1 },
        { id: 'b', albumId: ALBUM, name: 'b.jpg', size: 1 },
      ],
    });

  it('numbers items in the order given and ignores a repeated id', () => {
    const s = add();
    expect(s.items.map((i) => [i.id, i.order, i.status])).toEqual([
      ['a', 0, 'queued'],
      ['b', 1, 'queued'],
    ]);
    expect(queueReducer(s, { type: 'add', items: [{ id: 'a', albumId: ALBUM, name: 'a.jpg', size: 1 }] })).toBe(s);
  });

  it('a terminal item stays terminal until retried; late results are ignored', () => {
    let s = add();
    s = queueReducer(s, { type: 'cancel', id: 'a' });
    s = queueReducer(s, { type: 'status', id: 'a', status: 'uploading' });
    expect(s.items[0]!.status).toBe('cancelled');
    s = queueReducer(s, { type: 'fail', id: 'a', failure: { kind: 'upload', message: 'x' } });
    expect(s.items[0]!.status).toBe('cancelled');
    s = queueReducer(s, { type: 'retry', id: 'a', to: 'queued' });
    expect(s.items[0]!.status).toBe('queued');
    expect(queueReducer(s, { type: 'retry', id: 'a', to: 'queued' })).toBe(s);
  });

  it('only terminal items can be removed', () => {
    let s = add();
    expect(queueReducer(s, { type: 'remove', id: 'a' })).toBe(s);
    s = queueReducer(s, { type: 'fail', id: 'a', failure: { kind: 'corrupt', message: 'x' } });
    expect(queueReducer(s, { type: 'remove', id: 'a' }).items.map((i) => i.id)).toEqual(['b']);
  });

  it('offline marks items in network stages as waiting and online clears it', () => {
    let s = add();
    s = queueReducer(s, { type: 'status', id: 'a', status: 'encoding' });
    s = queueReducer(s, { type: 'status', id: 'a', status: 'encoded' });
    s = queueReducer(s, { type: 'online', online: false });
    expect(s.items.map((i) => i.paused)).toEqual([true, false]); // queued work does not need the network
    s = queueReducer(s, { type: 'online', online: true });
    expect(s.items.every((i) => !i.paused)).toBe(true);
  });

  it('summarizes', () => {
    let s = add();
    s = queueReducer(s, { type: 'fail', id: 'a', failure: { kind: 'corrupt', message: 'x' } });
    expect(summarize(s)).toEqual({ total: 2, done: 0, failed: 1, cancelled: 0, active: 1 });
  });
});
