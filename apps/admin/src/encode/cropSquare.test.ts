import { IG_AVATAR_MAX_BYTES, IG_AVATAR_PX } from '@mp/shared';
import { describe, expect, it } from 'vitest';
import { cs } from '../i18n/cs';
import { AVATAR_INPUT_MAX_BYTES, AvatarCropError, cropSquareWebp } from './cropSquare';
import type { Drawable, Rect, Surface, SurfaceFactory } from './surface';

interface Opts {
  decodeError?: boolean;
  blobType?: string;
  blobBytes?: number;
}

function stub(natW: number, natH: number, opts: Opts = {}) {
  const draws: Array<{ from: Rect; surface: { w: number; h: number } }> = [];
  const encoded: Array<{ w: number; h: number; type: string; quality: number }> = [];
  let open = 0;
  const factory: SurfaceFactory = {
    async decode() {
      if (opts.decodeError) throw new Error('bad');
      open++;
      return { width: natW, height: natH, close: () => void open-- } satisfies Drawable;
    },
    createSurface(w, h) {
      open++;
      const s: Surface = {
        width: w,
        height: h,
        drawFrom(_src, from) {
          draws.push({ from, surface: { w, h } });
        },
        getRgba: () => ({ data: new Uint8ClampedArray(0), width: w, height: h }),
        putRgba() {},
        async toBlob(type, quality) {
          encoded.push({ w, h, type, quality });
          return new Blob([new Uint8Array(opts.blobBytes ?? 3000)], { type: opts.blobType ?? type });
        },
        close: () => void open--,
      };
      return s;
    },
  };
  return { factory, draws, encoded, openCount: () => open };
}

const pick = (type = 'image/jpeg', name = 'a.jpg') => new File([new Uint8Array(16)], name, { type });

describe('cropSquareWebp', () => {
  it('centre-crops a landscape picture to a 480 x 480 WebP at quality 0.85', async () => {
    const s = stub(4000, 3000);
    const blob = await cropSquareWebp(pick(), IG_AVATAR_PX, s.factory);
    expect(blob.type).toBe('image/webp');
    expect(s.draws).toEqual([{ from: { x: 500, y: 0, w: 3000, h: 3000 }, surface: { w: 480, h: 480 } }]);
    expect(s.encoded).toEqual([{ w: 480, h: 480, type: 'image/webp', quality: 0.85 }]);
    expect(s.openCount()).toBe(0);
  });

  it('centre-crops a portrait picture to 480 x 480 and defaults the size to IG_AVATAR_PX', async () => {
    const s = stub(1500, 2000);
    await cropSquareWebp(pick('image/png', 'a.png'), undefined, s.factory);
    expect(s.draws).toEqual([{ from: { x: 0, y: 250, w: 1500, h: 1500 }, surface: { w: 480, h: 480 } }]);
    expect(s.encoded[0]).toMatchObject({ w: 480, h: 480 });
    expect(s.openCount()).toBe(0);
  });

  it('refuses a file that is not an image, before decoding', async () => {
    const s = stub(10, 10);
    const error = await cropSquareWebp(pick('application/pdf', 'a.pdf'), 480, s.factory).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AvatarCropError);
    expect(error).toMatchObject({ code: 'NOT_IMAGE', userMessage: cs.instagram.profile.dialog.cropNotImage });
    expect(s.draws).toHaveLength(0);
  });

  it('refuses an input over 25 MB', async () => {
    const big = pick();
    Object.defineProperty(big, 'size', { value: AVATAR_INPUT_MAX_BYTES + 1 });
    await expect(cropSquareWebp(big, 480, stub(10, 10).factory)).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' });
  });

  it('reports a decode failure', async () => {
    await expect(cropSquareWebp(pick(), 480, stub(10, 10, { decodeError: true }).factory)).rejects.toMatchObject({
      code: 'DECODE_FAILED',
      userMessage: cs.instagram.profile.dialog.cropDecodeFailed,
    });
  });

  it('reports a browser that cannot encode WebP, and releases the surfaces', async () => {
    const s = stub(800, 600, { blobType: 'image/png' });
    await expect(cropSquareWebp(pick(), 480, s.factory)).rejects.toMatchObject({ code: 'NOT_WEBP' });
    expect(s.openCount()).toBe(0);
  });

  it('refuses a result over IG_AVATAR_MAX_BYTES and accepts exactly the limit', async () => {
    await expect(cropSquareWebp(pick(), 480, stub(800, 600, { blobBytes: IG_AVATAR_MAX_BYTES + 1 }).factory)).rejects.toMatchObject({
      code: 'TOO_BIG',
    });
    const ok = await cropSquareWebp(pick(), 480, stub(800, 600, { blobBytes: IG_AVATAR_MAX_BYTES }).factory);
    expect(ok.size).toBe(IG_AVATAR_MAX_BYTES);
  });
});
