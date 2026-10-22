/**
 * Shared contract suite for every StorageAdapter. Call it from a test file:
 *   runStorageContract('fake', () => createFakeStorage({ baseUrl }), { publicBase: baseUrl })
 * Not exported from the package index (it imports vitest).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { StorageError, type StorageAdapter } from './adapter';

export interface ContractOptions {
  /** Expected prefix of publicUrl(key), without trailing slash. */
  publicBase: string;
  /** Prefix under which the suite writes its test objects. Default "contract-test/". */
  testPrefix?: string;
  /** True when the adapter must report `uploaded` (ISO) from list and head. Required for the fake, optional for others. */
  expectUploaded?: boolean;
}

const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);
const UNSAFE = ['', '../x', 'a/../b', '/abs', 'a\\b', 'k'.repeat(513)];

export function runStorageContract(
  name: string,
  makeAdapter: () => StorageAdapter | Promise<StorageAdapter>,
  opts: ContractOptions,
): void {
  const P = opts.testPrefix ?? 'contract-test/';
  let s: StorageAdapter;

  describe(`StorageAdapter contract: ${name}`, () => {
    beforeEach(async () => {
      s = await makeAdapter();
    });

    it('put then head returns size and content type; head of a missing key is null', async () => {
      const put = await s.put(`${P}a.bin`, bytes(10), { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' });
      expect(put).toMatchObject({ key: `${P}a.bin`, bytes: 10 });
      const head = await s.head(`${P}a.bin`);
      expect(head).toMatchObject({ key: `${P}a.bin`, bytes: 10, contentType: 'image/webp' });
      expect(await s.head(`${P}missing.bin`)).toBeNull();
    });

    it('put overwrites an existing key', async () => {
      await s.put(`${P}o.bin`, bytes(3), { contentType: 'image/jpeg' });
      await s.put(`${P}o.bin`, bytes(5), { contentType: 'image/jpeg' });
      expect((await s.head(`${P}o.bin`))?.bytes).toBe(5);
    });

    it('lists by prefix only', async () => {
      await s.put(`${P}x/1`, bytes(1), { contentType: 'image/jpeg' });
      await s.put(`${P}x/2`, bytes(2), { contentType: 'image/jpeg' });
      await s.put(`${P}y/1`, bytes(3), { contentType: 'image/jpeg' });
      const r = await s.list(`${P}x/`);
      expect(r.objects.map((o) => o.key)).toEqual([`${P}x/1`, `${P}x/2`]);
      expect(r.objects.map((o) => o.bytes)).toEqual([1, 2]);
      expect(r.cursor).toBeUndefined();
    });

    it('pages with a cursor and returns every key exactly once', async () => {
      for (let i = 0; i < 7; i++) await s.put(`${P}p/${String(i).padStart(2, '0')}`, bytes(1), { contentType: 'image/jpeg' });
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await s.list(`${P}p/`, cursor === undefined ? { limit: 3 } : { limit: 3, cursor });
        expect(page.objects.length).toBeLessThanOrEqual(3);
        seen.push(...page.objects.map((o) => o.key));
        cursor = page.cursor;
        pages++;
      } while (cursor !== undefined && pages < 10);
      expect(pages).toBe(3);
      expect(seen).toEqual(Array.from({ length: 7 }, (_, i) => `${P}p/${String(i).padStart(2, '0')}`));
    });

    it('list returns an ISO uploaded time when the implementation supports it', async () => {
      await s.put(`${P}u/1`, bytes(1), { contentType: 'image/jpeg' });
      const r = await s.list(`${P}u/`);
      const uploaded = r.objects[0]?.uploaded;
      if (opts.expectUploaded) expect(uploaded).toBeDefined();
      if (uploaded !== undefined) {
        expect(Number.isNaN(Date.parse(uploaded))).toBe(false);
        expect(new Date(uploaded).toISOString()).toBe(uploaded);
      }
    });

    it('delete of a missing key is a no-op', async () => {
      await expect(s.delete(`${P}nothing`)).resolves.toBeUndefined();
    });

    it('delete removes one key or many', async () => {
      for (const k of ['a', 'b', 'c', 'd']) await s.put(`${P}d/${k}`, bytes(1), { contentType: 'image/jpeg' });
      await s.delete(`${P}d/a`);
      expect(await s.head(`${P}d/a`)).toBeNull();
      await s.delete([`${P}d/b`, `${P}d/c`, `${P}d/never`]);
      expect((await s.list(`${P}d/`)).objects.map((o) => o.key)).toEqual([`${P}d/d`]);
    });

    it('rejects unsafe keys with INVALID_KEY on every method', async () => {
      for (const bad of UNSAFE) {
        const ct = { contentType: 'image/jpeg' };
        await expect(s.put(bad, bytes(1), ct)).rejects.toMatchObject({ code: 'INVALID_KEY' });
        await expect(s.head(bad)).rejects.toMatchObject({ code: 'INVALID_KEY' });
        await expect(s.delete(bad)).rejects.toMatchObject({ code: 'INVALID_KEY' });
        await expect(s.presignPut(bad, { ...ct, contentLength: 1, expiresInSec: 60 })).rejects.toMatchObject({ code: 'INVALID_KEY' });
        expect(() => s.publicUrl(bad)).toThrow(StorageError);
      }
      await expect(s.delete([`${P}ok`, '../bad'])).rejects.toMatchObject({ code: 'INVALID_KEY' });
    });

    it('publicUrl has the configured prefix and the key', () => {
      expect(s.publicUrl('photos/abc/480.webp')).toBe(`${opts.publicBase}/photos/abc/480.webp`);
    });

    it('presignPut returns a PUT url, headers and an expiry about expiresInSec ahead', async () => {
      const before = Date.now();
      const p = await s.presignPut(`${P}up.jpg`, { contentType: 'image/jpeg', contentLength: 123, expiresInSec: 900 });
      expect(p.method).toBe('PUT');
      expect(p.url.length).toBeGreaterThan(0);
      const exp = Date.parse(p.expiresAt);
      expect(exp).toBeGreaterThanOrEqual(before + 900_000 - 2000);
      expect(exp).toBeLessThanOrEqual(Date.now() + 900_000 + 2000);
    });
  });
}
