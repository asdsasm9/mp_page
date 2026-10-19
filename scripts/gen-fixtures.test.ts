import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGACY_GALLERIES_DIR, LEGACY_PHOTOS_JSON, jpegSize, readLegacyPhotos, serializeLegacyPhotos } from './gen-fixtures';

describe('gen-fixtures part 1', () => {
  it('regenerating produces a byte-identical legacy-photos.json (deterministic)', () => {
    const fresh = serializeLegacyPhotos(readLegacyPhotos());
    expect(fresh).toBe(readFileSync(LEGACY_PHOTOS_JSON, 'utf8'));
    expect(serializeLegacyPhotos(readLegacyPhotos())).toBe(fresh);
  });

  it('has 141 entries and the committed file stays small', () => {
    expect(readLegacyPhotos()).toHaveLength(141);
    expect(statSync(LEGACY_PHOTOS_JSON).size).toBeLessThan(400 * 1024);
  });

  it('jpegSize reads the SOF header and rejects non-jpeg', () => {
    const entry = readLegacyPhotos()[0]!;
    const buf = readFileSync(join(LEGACY_GALLERIES_DIR, ...entry.legacyKey.split('/')));
    expect(jpegSize(buf)).toEqual({ w: entry.width, h: entry.height });
    expect(jpegSize(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});
