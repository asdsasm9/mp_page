/**
 * Browser encoder (plan 4.7): decode -> master (<=3000 px, JPEG q0.85, re-drawn so EXIF/GPS cannot survive; the
 * original is never uploaded) -> variants from variantPlan of the master -> dominant colour. Honours the AbortSignal
 * between steps and never creates a surface above 3000 px per edge.
 */
import { fitWithin, variantPlan, type WebpTier } from '@mp/shared';
import type { Encoder, FileLike } from '../upload/types';
import { assembleEncodedPhoto, type EncodedPart, type EncodedParts } from './assemble';
import { decodeImage } from './decode';
import { EncodeError, throwIfAborted } from './errors';
import { resizeTo } from './resize';
import { sampleDominantColor } from './sampleColor';
import type { Drawable, Surface, SurfaceFactory } from './surface';

export const MASTER_QUALITY = 0.85;
export const WEBP_QUALITY = 0.8;
export const JPEG_QUALITY = 0.85;
export const OG_QUALITY = 0.82;

async function encodeSurface(surface: Surface, type: 'image/jpeg' | 'image/webp', quality: number): Promise<Blob> {
  const blob = await surface.toBlob(type, quality);
  if (type === 'image/webp' && blob.type !== 'image/webp') throw new EncodeError('NO_WEBP', `got ${blob.type}`);
  if (type === 'image/jpeg' && blob.type !== 'image/jpeg') throw new EncodeError('CORRUPT', `got ${blob.type}`);
  return blob;
}

export function createEncoder(factory: SurfaceFactory): Encoder {
  return {
    async encode(file: FileLike, signal: AbortSignal) {
      const source = await decodeImage(factory, file, signal);
      let master: Surface | null = null;
      try {
        const size = fitWithin(source.width, source.height);
        throwIfAborted(signal);
        master = resizeTo(factory, source, { x: 0, y: 0, w: source.width, h: source.height }, size.w, size.h, signal);
        source.close();
        return await encodeFromMaster(factory, master, signal);
      } finally {
        master?.close();
        source.close();
      }
    },
  };
}

/** One variant: draw `from` of the master at w x h and encode it. */
async function variant(
  factory: SurfaceFactory,
  master: Drawable,
  from: { x: number; y: number; w: number; h: number },
  w: number,
  h: number,
  type: 'image/jpeg' | 'image/webp',
  quality: number,
  signal: AbortSignal,
): Promise<EncodedPart> {
  throwIfAborted(signal);
  const surface = resizeTo(factory, master, from, w, h, signal);
  try {
    const blob = await encodeSurface(surface, type, quality);
    return { w: surface.width, h: surface.height, blob };
  } finally {
    surface.close();
  }
}

async function encodeFromMaster(factory: SurfaceFactory, master: Surface, signal: AbortSignal) {
  const width = master.width;
  const height = master.height;
  const plan = variantPlan(width, height);
  const whole = { x: 0, y: 0, w: width, h: height };

  // WebP first: a browser that cannot write it fails before any other work is spent.
  const webp: EncodedParts['webp'] = [];
  for (const t of plan.webp) {
    webp.push({ tier: t.tier as WebpTier, ...(await variant(factory, master, whole, t.w, t.h, 'image/webp', WEBP_QUALITY, signal)) });
  }
  const jpeg = await variant(factory, master, whole, plan.jpeg.w, plan.jpeg.h, 'image/jpeg', JPEG_QUALITY, signal);
  const og = await variant(factory, master, plan.og.crop, plan.og.w, plan.og.h, 'image/jpeg', OG_QUALITY, signal);
  throwIfAborted(signal);
  const masterBlob = await encodeSurface(master, 'image/jpeg', MASTER_QUALITY);
  const masterPart: EncodedPart = { w: width, h: height, blob: masterBlob };

  let colour: string | undefined;
  try {
    throwIfAborted(signal);
    colour = sampleDominantColor(factory, master, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    colour = undefined; // the photo still uploads without a colour
  }
  throwIfAborted(signal);
  return assembleEncodedPhoto({ master: masterPart, webp, jpeg, og }, width, height, colour);
}
