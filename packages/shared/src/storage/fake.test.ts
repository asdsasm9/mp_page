import { describe, expect, it } from 'vitest';
import { StorageError } from './adapter';
import { runStorageContract } from './contract';
import { createFakeStorage } from './fake';

const baseUrl = 'https://img.example.test';

runStorageContract('fake', () => createFakeStorage({ baseUrl: `${baseUrl}/` }), { publicBase: baseUrl });

describe('fake storage helpers', () => {
  it('simulatePut writes the object after a presign', async () => {
    const fake = createFakeStorage({ baseUrl });
    const p = await fake.presignPut('photos/x/master.jpg', { contentType: 'image/jpeg', contentLength: 4, expiresInSec: 900 });
    expect(p.url.startsWith('fake://put/photos/x/master.jpg')).toBe(true);
    await fake.simulatePut(p, new Uint8Array(4), { 'content-type': 'image/jpeg' });
    expect(await fake.head('photos/x/master.jpg')).toMatchObject({ bytes: 4, contentType: 'image/jpeg' });
    expect(fake.totalBytes()).toBe(4);
    expect(fake.keys()).toEqual(['photos/x/master.jpg']);
  });

  it('enforceContentLength true rejects a larger body, false accepts it', async () => {
    const strict = createFakeStorage({ baseUrl, enforceContentLength: true });
    const loose = createFakeStorage({ baseUrl, enforceContentLength: false });
    const opts = { contentType: 'image/jpeg', contentLength: 10, expiresInSec: 60 };
    const ps = await strict.presignPut('k/a', opts);
    const pl = await loose.presignPut('k/a', opts);
    await expect(strict.simulatePut(ps, new Uint8Array(1000))).rejects.toMatchObject({ code: 'CONTENT_LENGTH_MISMATCH' });
    expect(await strict.head('k/a')).toBeNull();
    await expect(loose.simulatePut(pl, new Uint8Array(1000))).resolves.toMatchObject({ bytes: 1000 });
    expect((await loose.head('k/a'))?.bytes).toBe(1000);
  });

  it('rejects expired presigned URLs using the injected clock', async () => {
    let t = Date.parse('2026-10-19T12:00:00Z');
    const fake = createFakeStorage({ baseUrl, now: () => new Date(t) });
    const p = await fake.presignPut('k/a', { contentType: 'image/jpeg', contentLength: 2, expiresInSec: 900 });
    expect(p.expiresAt).toBe('2026-10-19T12:15:00.000Z');
    t += 899_000;
    await expect(fake.simulatePut(p, new Uint8Array(2))).resolves.toMatchObject({ bytes: 2 });
    t += 2_000;
    await expect(fake.simulatePut(p, new Uint8Array(2))).rejects.toMatchObject({ code: 'URL_EXPIRED' });
  });

  it('rejects a url it never issued', async () => {
    const fake = createFakeStorage({ baseUrl });
    await expect(
      fake.simulatePut({ url: 'fake://put/k?exp=1', method: 'PUT', headers: {}, expiresAt: '' }, new Uint8Array(1)),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it('stores a copy of the body', async () => {
    const fake = createFakeStorage({ baseUrl });
    const body = new Uint8Array([1, 2, 3]);
    await fake.put('k/a', body, { contentType: 'image/jpeg' });
    body[0] = 9;
    expect(fake.totalBytes()).toBe(3);
  });
});
