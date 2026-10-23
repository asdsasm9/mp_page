import { MAX_INPUT_FILE_BYTES } from '@mp/shared';
import { describe, expect, it } from 'vitest';
import { cs } from '../i18n/cs';
import type { FileLike } from '../upload/types';
import { decodeImage } from './decode';
import { createEncoder } from './encodePhoto';
import { detectTouch, guardInput, maxPixels, sniffImageSize } from './inputGuard';
import type { Drawable, SurfaceFactory } from './surface';

const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];

/** SOI, an APP0 segment, then SOF0. */
const jpeg = (w: number, h: number) => [0xff, 0xd8, 0xff, 0xe0, ...u16(16), ...new Array(14).fill(0), 0xff, 0xc0, ...u16(17), 8, ...u16(h), ...u16(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
const png = (w: number, h: number) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32(13), 0x49, 0x48, 0x44, 0x52, ...u32(w), ...u32(h), 8, 2, 0, 0, 0];
const riff = (fourcc: string, payload: number[]) => [0x52, 0x49, 0x46, 0x46, ...u32(0), 0x57, 0x45, 0x42, 0x50, ...[...fourcc].map((c) => c.charCodeAt(0)), ...le32(payload.length), ...payload];
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const vp8x = (w: number, h: number) => riff('VP8X', [0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]);
const vp8 = (w: number, h: number) => riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, w & 0xff, w >> 8, h & 0xff, h >> 8]);
const vp8l = (w: number, h: number) => {
  const wm = w - 1;
  const hm = h - 1;
  return riff('VP8L', [0x2f, wm & 0xff, ((wm >> 8) & 0x3f) | ((hm & 3) << 6), (hm >> 2) & 0xff, (hm >> 10) & 0x0f]);
};

function blobFile(bytes: number[], size = bytes.length, name = 'a.jpg', type = 'image/jpeg') {
  const reads: number[] = [];
  const file = {
    name,
    type,
    size,
    lastModified: 1,
    slice(start: number, end: number) {
      reads.push(end);
      return { arrayBuffer: async () => new Uint8Array(bytes).slice(start, end).buffer };
    },
  };
  return { file: file as FileLike, reads };
}

function spyFactory() {
  const calls = { decode: 0, surface: 0 };
  const factory: SurfaceFactory = {
    async decode() {
      calls.decode++;
      return { width: 100, height: 100, close() {} } satisfies Drawable;
    },
    createSurface() {
      calls.surface++;
      throw new Error('must not be called');
    },
  };
  return { factory, calls };
}

describe('sniffImageSize', () => {
  it('reads JPEG SOF behind other segments, PNG IHDR and all three WebP flavours', () => {
    expect(sniffImageSize(new Uint8Array(jpeg(6000, 4000)))).toEqual({ width: 6000, height: 4000 });
    expect(sniffImageSize(new Uint8Array(png(8000, 5000)))).toEqual({ width: 8000, height: 5000 });
    expect(sniffImageSize(new Uint8Array(vp8x(9000, 6000)))).toEqual({ width: 9000, height: 6000 });
    expect(sniffImageSize(new Uint8Array(vp8(1234, 987)))).toEqual({ width: 1234, height: 987 });
    expect(sniffImageSize(new Uint8Array(vp8l(5000, 3333)))).toEqual({ width: 5000, height: 3333 });
  });

  it('returns null for a recognised format with a broken header and undefined for unknown data', () => {
    expect(sniffImageSize(new Uint8Array(jpeg(10, 10).slice(0, 12)))).toBeNull(); // truncated before SOF
    expect(sniffImageSize(new Uint8Array(jpeg(0, 0)))).toBeNull();
    expect(sniffImageSize(new Uint8Array([0xff, 0xd8, 0x00, 0x00, 0x00, 0x00]))).toBeNull();
    expect(sniffImageSize(new Uint8Array(png(1, 1).slice(0, 14)))).toBeNull();
    expect(sniffImageSize(new Uint8Array(vp8x(10, 10).slice(0, 20)))).toBeNull();
    expect(sniffImageSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]))).toBeUndefined();
  });
});

describe('guardInput boundaries', () => {
  it('accepts exactly 50 MiB and refuses one byte more with the file-size text', async () => {
    await expect(guardInput(blobFile(jpeg(100, 100), MAX_INPUT_FILE_BYTES).file, false)).resolves.toBeUndefined();
    const over = blobFile(jpeg(100, 100), MAX_INPUT_FILE_BYTES + 1);
    await expect(guardInput(over.file, false)).rejects.toMatchObject({
      code: 'TOO_LARGE',
      userMessage: 'Soubor je příliš velký (nad 50 MB). Zmenšete ho a zkuste to znovu.',
    });
    expect(over.reads).toHaveLength(0); // refused without reading the file
  });

  it('desktop: 64 MP passes (8000x8000), 64 MP + 1 pixel is refused', async () => {
    expect(maxPixels(false)).toBe(64_000_000);
    await expect(guardInput(blobFile(jpeg(8000, 8000)).file, false)).resolves.toBeUndefined();
    await expect(guardInput(blobFile(jpeg(8000, 8001)).file, false)).rejects.toMatchObject({
      code: 'TOO_MANY_PIXELS',
      userMessage: 'Fotka má příliš mnoho pixelů (nad 64 MP; na telefonu nad 40 MP).',
    });
    await expect(guardInput(blobFile(png(8000, 8001), 5000, 'a.png', 'image/png').file, false)).rejects.toMatchObject({ code: 'TOO_MANY_PIXELS' });
    await expect(guardInput(blobFile(vp8x(8000, 8001), 5000, 'a.webp', 'image/webp').file, false)).rejects.toMatchObject({ code: 'TOO_MANY_PIXELS' });
  });

  it('touch: 40 MP passes (8000x5000), 40 MP + 1 is refused, while desktop still accepts it', async () => {
    expect(maxPixels(true)).toBe(40_000_000);
    await expect(guardInput(blobFile(jpeg(8000, 5000)).file, true)).resolves.toBeUndefined();
    await expect(guardInput(blobFile(jpeg(8000, 5001)).file, true)).rejects.toMatchObject({ code: 'TOO_MANY_PIXELS' });
    await expect(guardInput(blobFile(jpeg(8000, 5001)).file, false)).resolves.toBeUndefined();
  });

  it('a corrupt header gives the CORRUPT message', async () => {
    await expect(guardInput(blobFile(jpeg(10, 10).slice(0, 10)).file, false)).rejects.toMatchObject({
      code: 'CORRUPT',
      userMessage: 'Tuto fotku se nepodařilo načíst.',
    });
    expect(cs.encode.corrupt).toBe('Tuto fotku se nepodařilo načíst.');
  });

  it('an unreadable file is CORRUPT, an unknown format is left to the post-decode check', async () => {
    const broken = { name: 'a.jpg', type: 'image/jpeg', size: 10, lastModified: 1, slice: () => ({ arrayBuffer: async () => { throw new Error('io'); } }) };
    await expect(guardInput(broken as FileLike, false)).rejects.toMatchObject({ code: 'CORRUPT' });
    await expect(guardInput(blobFile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], 13, 'a.heic', 'image/heic').file, false)).resolves.toBeUndefined();
  });

  it('reads at most the first 64 KB', async () => {
    const f = blobFile(jpeg(100, 100));
    await guardInput(f.file, false);
    expect(f.reads).toEqual([65536]);
  });
});

describe('a rejected file reaches neither decoder nor encoder', () => {
  const cases: Array<[string, ReturnType<typeof blobFile>, string]> = [
    ['too many bytes', blobFile(jpeg(100, 100), MAX_INPUT_FILE_BYTES + 1), 'TOO_LARGE'],
    ['too many pixels', blobFile(jpeg(9000, 9000)), 'TOO_MANY_PIXELS'],
    ['corrupt header', blobFile([0xff, 0xd8, 0xff, 0xe0, 0, 16]), 'CORRUPT'],
  ];
  for (const [label, f, code] of cases) {
    it(label, async () => {
      const spy = spyFactory();
      await expect(createEncoder(spy.factory).encode(f.file, new AbortController().signal)).rejects.toMatchObject({ code });
      expect(spy.calls).toEqual({ decode: 0, surface: 0 });
    });
  }

  it('decodeImage applies the touch limit to the decoded size of formats the sniffer does not know', async () => {
    const big: SurfaceFactory = {
      async decode() {
        return { width: 7000, height: 6000, close() {} };
      },
      createSurface() {
        throw new Error('no');
      },
    };
    const f: FileLike = { name: 'a.avif', type: 'image/avif', size: 100, lastModified: 1 };
    await expect(decodeImage(big, f, new AbortController().signal, true)).rejects.toMatchObject({ code: 'TOO_MANY_PIXELS' });
    await expect(decodeImage(big, f, new AbortController().signal, false)).resolves.toMatchObject({ width: 7000 });
  });
});

describe('detectTouch', () => {
  it('falls back to touch (the stricter limit) when matchMedia is missing or throws', () => {
    const original = globalThis.matchMedia;
    try {
      // @ts-expect-error simulate an environment without matchMedia
      globalThis.matchMedia = undefined;
      expect(detectTouch()).toBe(true);
      globalThis.matchMedia = (() => {
        throw new Error('boom');
      }) as unknown as typeof matchMedia;
      expect(detectTouch()).toBe(true);
      globalThis.matchMedia = ((q: string) => ({ matches: false, media: q })) as unknown as typeof matchMedia;
      expect(detectTouch()).toBe(false);
      globalThis.matchMedia = ((q: string) => ({ matches: q.includes('coarse'), media: q })) as unknown as typeof matchMedia;
      expect(detectTouch()).toBe(true);
    } finally {
      globalThis.matchMedia = original;
    }
  });
});
