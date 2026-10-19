import { describe, expect, it } from 'vitest';
import { StorageError } from '@mp/shared';
import { runStorageContract } from '../../../../packages/shared/src/storage/contract';
import { goodEnv } from '../test-support';
import { createFakeR2Bucket } from './fake-bucket';
import { createR2Storage } from './r2';

const PUBLIC = 'https://img.mullnyphotos.cz';
const ENV = goodEnv();
const presign = {
  accountId: ENV.R2_ACCOUNT_ID!,
  accessKeyId: ENV.R2_ACCESS_KEY_ID!,
  secretAccessKey: ENV.R2_SECRET_ACCESS_KEY!,
  bucketName: ENV.R2_BUCKET!,
};
const make = () => createR2Storage({ bucket: createFakeR2Bucket(), publicBaseUrl: `${PUBLIC}/`, presign });

runStorageContract('r2', make, { publicBase: PUBLIC, expectUploaded: true });

describe('R2 adapter', () => {
  it('deletes 2500 keys in chunks of at most 1000', async () => {
    const bucket = createFakeR2Bucket();
    const s = createR2Storage({ bucket, publicBaseUrl: PUBLIC, presign });
    const keys = Array.from({ length: 2500 }, (_, i) => `bulk/${String(i).padStart(4, '0')}`);
    for (const k of keys) await s.put(k, new Uint8Array(1), { contentType: 'image/jpeg' });
    await s.delete([...keys, 'bulk/never-existed']);
    expect(bucket.keys()).toEqual([]);
    expect(bucket.deleteCalls).toEqual([1000, 1000, 501]);
  });

  it('stores content type and cache control as http metadata', async () => {
    const bucket = createFakeR2Bucket();
    const s = createR2Storage({ bucket, publicBaseUrl: PUBLIC });
    await s.put('catalog/published.json', new Uint8Array(2), { contentType: 'application/json', cacheControl: 'no-cache' });
    const raw = await bucket.head('catalog/published.json');
    expect(raw?.httpMetadata).toEqual({ contentType: 'application/json', cacheControl: 'no-cache' });
  });

  it('clamps list limit to 1000', async () => {
    const s = make();
    await s.put('l/1', new Uint8Array(1), { contentType: 'image/jpeg' });
    const r = await s.list('l/', { limit: 50_000 });
    expect(r.objects).toHaveLength(1);
  });
});

describe('R2 presign', () => {
  const fixed = new Date('2026-10-19T10:00:00.000Z');
  const sign = (contentLength: number, cacheControl?: string) =>
    createR2Storage({ bucket: createFakeR2Bucket(), publicBaseUrl: PUBLIC, presign, now: () => fixed }).presignPut(
      'photos/0a1b2c3d-0000-4000-8000-000000000001/master.jpg',
      { contentType: 'image/jpeg', contentLength, expiresInSec: 900, ...(cacheControl ? { cacheControl } : {}) },
    );

  it('signs a PUT URL on the account endpoint with bucket and key in the path', async () => {
    const p = await sign(1234, 'public, max-age=31536000, immutable');
    const u = new URL(p.url);
    expect(p.method).toBe('PUT');
    expect(u.host).toBe(`${presign.accountId}.r2.cloudflarestorage.com`);
    expect(u.pathname).toBe(`/${presign.bucketName}/photos/0a1b2c3d-0000-4000-8000-000000000001/master.jpg`);
    expect(u.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(u.searchParams.get('X-Amz-Credential')).toContain(presign.accessKeyId);
    expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(p.expiresAt).toBe('2026-10-19T10:15:00.000Z');
  });

  it('never leaks the secret key', async () => {
    const p = await sign(1234);
    expect(p.url).not.toContain(presign.secretAccessKey);
    expect(JSON.stringify(p)).not.toContain(presign.secretAccessKey);
  });

  it('signs content-length, content-type and cache-control; the signature changes with the length', async () => {
    const a = await sign(1000, 'public, max-age=31536000, immutable');
    const b = await sign(1001, 'public, max-age=31536000, immutable');
    const signed = new URL(a.url).searchParams.get('X-Amz-SignedHeaders')!.split(';');
    expect(signed).toEqual(expect.arrayContaining(['content-length', 'content-type', 'cache-control', 'host']));
    expect(new URL(a.url).searchParams.get('X-Amz-Signature')).not.toBe(new URL(b.url).searchParams.get('X-Amz-Signature'));
    expect(a.headers).toEqual({
      'content-type': 'image/jpeg',
      'content-length': '1000',
      'cache-control': 'public, max-age=31536000, immutable',
    });
  });
});

describe('backup adapter (no presign, no public URL)', () => {
  const backup = () => createR2Storage({ bucket: createFakeR2Bucket() });

  it('presignPut and publicUrl throw NOT_CONFIGURED', async () => {
    await expect(
      backup().presignPut('backup/full-1.json', { contentType: 'application/json', contentLength: 1, expiresInSec: 60 }),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(() => backup().publicUrl('backup/full-1.json')).toThrow(StorageError);
    try {
      backup().publicUrl('backup/full-1.json');
    } catch (e) {
      expect((e as StorageError).code).toBe('NOT_CONFIGURED');
    }
  });

  it('still stores and lists objects', async () => {
    const s = backup();
    await s.put('backup/full-1.json', new Uint8Array(3), { contentType: 'application/json' });
    expect((await s.list('backup/')).objects.map((o) => o.key)).toEqual(['backup/full-1.json']);
  });
});
