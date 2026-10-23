/**
 * Browser encoder (plan 4.7, WP-10): decode -> master (<=3000 px, JPEG, re-drawn so EXIF/GPS cannot survive; the
 * original is never uploaded) -> overview set (WebP 480/720/960, sharpened) and detail set (WebP 1600/2400, JPEG 1600,
 * OG, master) from the master -> dominant colour. Every variant starts at its table quality and steps down to its byte
 * cap (never below the floor). Honours the AbortSignal between steps and never creates a surface above 3000 px per edge.
 */
import {
  MAX_QUALITY_RETRIES,
  QUALITY_STEP,
  QUALITY_TABLE,
  fitWithin,
  variantPlan,
  webpQualityKey,
  type QualityKey,
  type WebpTier,
} from '@mp/shared';
import type { EncodePhase, Encoder, FileLike } from '../upload/types';
import { assembleEncodedPhoto, type EncodedPart, type EncodedParts } from './assemble';
import { decodeImage } from './decode';
import { EncodeError, throwIfAborted } from './errors';
import { resizeTo } from './resize';
import { sampleDominantColor } from './sampleColor';
import { OG_SHARPEN_AMOUNT, sharpenLuma, webpSharpenAmount } from './sharpen';
import type { Drawable, Surface, SurfaceFactory } from './surface';

export type { EncodePhase };
export const ENCODE_PHASE_LABEL: Record<EncodePhase, string> = {
  previews: 'Připravuji náhledy',
  detail: 'Nahrávám detail',
};
export type EncodePhaseCallback = (phase: EncodePhase) => void;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Encodes at the table's start quality; while over the cap, steps down by QUALITY_STEP (max MAX_QUALITY_RETRIES
 * times, never below the floor). The last result is kept even when still over the cap (D-8).
 */
export async function encodeAdaptive(
  surface: Pick<Surface, 'toBlob'>,
  type: 'image/jpeg' | 'image/webp',
  key: QualityKey,
  signal?: AbortSignal,
): Promise<Blob> {
  const entry = QUALITY_TABLE[key];
  let quality: number = entry.start;
  let blob = await encodeBlob(surface, type, quality);
  for (let retry = 0; retry < MAX_QUALITY_RETRIES && blob.size > entry.capBytes; retry++) {
    const next = round2(quality - QUALITY_STEP);
    if (next < entry.floor) break;
    throwIfAborted(signal);
    quality = next;
    blob = await encodeBlob(surface, type, quality);
  }
  return blob;
}

async function encodeBlob(surface: Pick<Surface, 'toBlob'>, type: 'image/jpeg' | 'image/webp', quality: number): Promise<Blob> {
  const blob = await surface.toBlob(type, quality);
  if (type === 'image/webp' && blob.type !== 'image/webp') throw new EncodeError('NO_WEBP', `got ${blob.type}`);
  if (type === 'image/jpeg' && blob.type !== 'image/jpeg') throw new EncodeError('CORRUPT', `got ${blob.type}`);
  return blob;
}

export function createEncoder(factory: SurfaceFactory): Encoder {
  return {
    async encode(file: FileLike, signal: AbortSignal, onPhase?: EncodePhaseCallback) {
      const source = await decodeImage(factory, file, signal);
      let master: Surface | null = null;
      try {
        const size = fitWithin(source.width, source.height);
        throwIfAborted(signal);
        master = resizeTo(factory, source, { x: 0, y: 0, w: source.width, h: source.height }, size.w, size.h, signal);
        source.close();
        return await encodeFromMaster(factory, master, signal, onPhase);
      } finally {
        master?.close();
        source.close();
      }
    },
  };
}

/** One variant: draw `from` of the master at w x h, sharpen the luma by `sharpen`, encode with the adaptive step-down. */
async function variant(
  factory: SurfaceFactory,
  master: Drawable,
  from: { x: number; y: number; w: number; h: number },
  w: number,
  h: number,
  type: 'image/jpeg' | 'image/webp',
  key: QualityKey,
  sharpen: number,
  signal: AbortSignal,
): Promise<EncodedPart> {
  throwIfAborted(signal);
  const surface = resizeTo(factory, master, from, w, h, signal);
  try {
    if (sharpen > 0) {
      try {
        const rgba = surface.getRgba();
        const data = rgba.data as Uint8ClampedArray;
        await sharpenLuma(data, rgba.width, rgba.height, sharpen, signal);
        throwIfAborted(signal);
        surface.putRgba(data);
      } catch (error) {
        if (signal.aborted) throw error;
        // sharpening is cosmetic (a browser may block pixel reads): the variant is encoded unsharpened
      }
    }
    const blob = await encodeAdaptive(surface, type, key, signal);
    return { w: surface.width, h: surface.height, blob };
  } finally {
    surface.close();
  }
}

async function encodeFromMaster(factory: SurfaceFactory, master: Surface, signal: AbortSignal, onPhase?: EncodePhaseCallback) {
  const width = master.width;
  const height = master.height;
  const plan = variantPlan(width, height);
  const whole = { x: 0, y: 0, w: width, h: height };
  const webp: EncodedParts['webp'] = [];

  const addWebp = async (t: (typeof plan.webp)[number]) => {
    const key = webpQualityKey(t.tier);
    if (!key) throw new EncodeError('CORRUPT', `no quality entry for webp${t.tier}`);
    webp.push({ tier: t.tier as WebpTier, ...(await variant(factory, master, whole, t.w, t.h, 'image/webp', key, webpSharpenAmount(t.tier), signal)) });
  };

  // Overview set first: a browser that cannot write WebP fails before any other work is spent.
  onPhase?.('previews');
  for (const t of plan.webp.filter((e) => e.tier <= 960)) await addWebp(t);

  onPhase?.('detail');
  for (const t of plan.webp.filter((e) => e.tier > 960)) await addWebp(t);
  const jpeg = await variant(factory, master, whole, plan.jpeg.w, plan.jpeg.h, 'image/jpeg', 'jpeg1600', 0, signal);
  const og = await variant(factory, master, plan.og.crop, plan.og.w, plan.og.h, 'image/jpeg', 'og', OG_SHARPEN_AMOUNT, signal);
  throwIfAborted(signal);
  const masterBlob = await encodeAdaptive(master, 'image/jpeg', 'master', signal);
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
