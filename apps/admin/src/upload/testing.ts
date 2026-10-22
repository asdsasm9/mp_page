/**
 * Test helpers for the upload UI: a stub encoder that returns a valid EncodedPhoto without a canvas, and fake File
 * objects. Not imported by the app, so it is not part of any bundle.
 */
import { planUploadFiles, variantPlan } from '@mp/shared';
import type { EncodedPhoto, Encoder, FileLike } from './types';

const SIZE_OF = { master: 1000, webp: 200, jpeg: 500, og: 300 } as const;

/** A photo that follows the shared variant plan for `width` x `height`, with small Blob bodies. */
export function encodedPhoto(width = 3000, height = 2000): EncodedPhoto {
  const plan = variantPlan(width, height);
  const planned = planUploadFiles('dddddddd-0000-4000-8000-000000000000', width, height);
  return {
    width,
    height,
    dominantColor: '#336699',
    variants: {
      master: { w: plan.master.w, h: plan.master.h, bytes: SIZE_OF.master },
      webp: plan.webp.map((e) => ({ tier: e.tier as 480, w: e.w, h: e.h, bytes: SIZE_OF.webp })),
      jpeg: { w: plan.jpeg.w, h: plan.jpeg.h, bytes: SIZE_OF.jpeg },
      og: { w: plan.og.w, h: plan.og.h, bytes: SIZE_OF.og },
    },
    files: planned.map((p) => ({
      kind: p.kind,
      ...(p.tier === undefined ? {} : { tier: p.tier }),
      bytes: SIZE_OF[p.kind],
      body: new Blob([new Uint8Array(SIZE_OF[p.kind])]),
    })),
  };
}

export interface StubEncoder extends Encoder {
  readonly calls: string[];
}

/** Encodes instantly; `fail` can make a file throw (an Error with `code` and `userMessage` like EncodeError). */
export function stubEncoder(fail?: (name: string) => Error | undefined): StubEncoder {
  const calls: string[] = [];
  return {
    calls,
    async encode(file: FileLike) {
      calls.push(file.name);
      const error = fail?.(file.name);
      if (error) throw error;
      return encodedPhoto();
    },
  };
}

export function pickedFile(name: string, size = 1000, type = 'image/jpeg'): File {
  return new File([new Uint8Array(size)], name, { type });
}
