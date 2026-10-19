import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_KEY,
  allKeys,
  backupKey,
  isSafeKey,
  isValidPhotoId,
  jpegKey,
  masterKey,
  ogKey,
  parseKey,
  photoPrefix,
  webpKey,
} from './keys';

const ID = '123e4567-e89b-42d3-a456-426614174000';

describe('key strings', () => {
  it('matches the spec exactly', () => {
    expect(photoPrefix(ID)).toBe(`photos/${ID}/`);
    expect(masterKey(ID)).toBe(`photos/${ID}/master.jpg`);
    expect(webpKey(ID, 480)).toBe(`photos/${ID}/480.webp`);
    expect(webpKey(ID, 960)).toBe(`photos/${ID}/960.webp`);
    expect(webpKey(ID, 1600)).toBe(`photos/${ID}/1600.webp`);
    expect(webpKey(ID, 2400)).toBe(`photos/${ID}/2400.webp`);
    expect(jpegKey(ID)).toBe(`photos/${ID}/1600.jpg`);
    expect(ogKey(ID)).toBe(`photos/${ID}/og.jpg`);
    expect(SNAPSHOT_KEY).toBe('catalog/published.json');
  });
  it('backupKey formats UTC', () => {
    expect(backupKey(new Date('2026-10-19T12:00:00Z'))).toBe('full-20261019T120000Z.json');
    expect(backupKey(new Date('2026-01-02T03:04:05.678Z'))).toBe('full-20260102T030405Z.json');
  });
  it('refuses bad ids', () => {
    expect(() => masterKey(ID.toUpperCase())).toThrow();
    expect(() => masterKey('not-a-uuid')).toThrow();
    expect(() => masterKey('../x')).toThrow();
    // @ts-expect-error invalid tier
    expect(() => webpKey(ID, 100)).toThrow();
  });
});

describe('isValidPhotoId', () => {
  it('accepts lowercase uuid only', () => {
    expect(isValidPhotoId(ID)).toBe(true);
    expect(isValidPhotoId(ID.toUpperCase())).toBe(false);
    expect(isValidPhotoId('abc')).toBe(false);
    expect(isValidPhotoId(`${ID}x`)).toBe(false);
    expect(isValidPhotoId('')).toBe(false);
  });
});

describe('parseKey', () => {
  it('round-trips every kind', () => {
    expect(parseKey(masterKey(ID))).toEqual({ kind: 'master', id: ID });
    for (const t of [480, 960, 1600, 2400] as const) {
      expect(parseKey(webpKey(ID, t))).toEqual({ kind: 'webp', id: ID, tier: t });
    }
    expect(parseKey(jpegKey(ID))).toEqual({ kind: 'jpeg', id: ID });
    expect(parseKey(ogKey(ID))).toEqual({ kind: 'og', id: ID });
  });
  it('returns null for foreign keys', () => {
    expect(parseKey(SNAPSHOT_KEY)).toBeNull();
    expect(parseKey(`photos/${ID}/700.webp`)).toBeNull();
    expect(parseKey(`photos/${ID}/other.jpg`)).toBeNull();
    expect(parseKey(`photos/${ID.toUpperCase()}/master.jpg`)).toBeNull();
    expect(parseKey(`photos/${ID}/sub/master.jpg`)).toBeNull();
    expect(parseKey('')).toBeNull();
  });
});

describe('isSafeKey', () => {
  it('rejects unsafe keys', () => {
    expect(isSafeKey('..')).toBe(false);
    expect(isSafeKey('a/../b')).toBe(false);
    expect(isSafeKey('/x')).toBe(false);
    expect(isSafeKey('a\\b')).toBe(false);
    expect(isSafeKey('')).toBe(false);
    expect(isSafeKey('a'.repeat(513))).toBe(false);
  });
  it('accepts safe keys', () => {
    expect(isSafeKey(masterKey(ID))).toBe(true);
    expect(isSafeKey('a'.repeat(512))).toBe(true);
    expect(isSafeKey(SNAPSHOT_KEY)).toBe(true);
  });
});

describe('allKeys', () => {
  it('lists every key a photo owns', () => {
    const keys = allKeys(ID, { webp: [{ tier: 480, w: 480, h: 320, bytes: 1 }, { tier: 960, w: 960, h: 640, bytes: 1 }] });
    expect(keys).toEqual([masterKey(ID), webpKey(ID, 480), webpKey(ID, 960), jpegKey(ID), ogKey(ID)]);
    for (const k of keys) expect(parseKey(k)).not.toBeNull();
  });
});
