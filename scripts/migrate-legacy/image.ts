// Image pipeline of the legacy migration (plan WP-06 3.5): one source file -> master, WebP tiers, 1600 JPEG, OG,
// real byte sizes and dominant colour. Same plan as the browser encoder (variantPlan of the master). sharp drops
// EXIF/GPS/ICC unless asked to keep it, and nothing here asks. Offline, pure (no file or network access).
import sharp from 'sharp';
import { variantsMatchPlan } from '../../packages/shared/src/api';
import { fitWithin, sumBytes, variantPlan, type PhotoVariants } from '../../packages/shared/src/variants';
import { dominantColorOf } from '../dominant-color';
import { hasExif } from '../dev-images';

/** Quality constants, sharp scale (0-100). Mirror apps/admin/src/encode/encodePhoto.ts (0-1); an equality test guards them. */
export const MASTER_QUALITY = 85;
export const WEBP_QUALITY = 80;
export const JPEG_QUALITY = 85;
export const OG_QUALITY = 82;

export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageError';
  }
}

export interface EncodedFile {
  w: number;
  h: number;
  buffer: Buffer;
}

export interface ProcessedPhoto {
  master: EncodedFile;
  webp: Array<EncodedFile & { tier: number }>;
  jpeg: EncodedFile;
  og: EncodedFile;
  /** Lowercase #rrggbb. */
  dominantColor: string;
  /** Variants jsonb with real byte sizes. */
  variants: PhotoVariants;
  /** Equals sumBytes(variants). */
  bytesTotal: number;
}

const jpegOut = (pipe: sharp.Sharp, quality: number) => pipe.jpeg({ quality, mozjpeg: true }).toBuffer();

async function dimsOf(buffer: Buffer): Promise<{ w: number; h: number }> {
  const m = await sharp(buffer).metadata();
  return { w: m.width ?? 0, h: m.height ?? 0 };
}

/** Process one source image. Throws ImageError when a sanity check fails (the caller aborts the album). */
export async function processImage(source: Buffer): Promise<ProcessedPhoto> {
  let srcW: number;
  let srcH: number;
  try {
    const meta = await sharp(source).metadata();
    // EXIF orientation 5-8 swaps the axes; .rotate() below applies it.
    const swap = (meta.orientation ?? 1) >= 5;
    srcW = (swap ? meta.height : meta.width) ?? 0;
    srcH = (swap ? meta.width : meta.height) ?? 0;
  } catch (e) {
    throw new ImageError(`cannot decode image: ${(e as Error).message}`);
  }
  if (srcW < 1 || srcH < 1) throw new ImageError('image has no dimensions');

  const size = fitWithin(srcW, srcH);
  const masterBuf = await jpegOut(
    sharp(source).rotate().toColourspace('srgb').resize({ width: size.w, height: size.h, fit: 'fill' }),
    MASTER_QUALITY,
  );
  const master: EncodedFile = { w: size.w, h: size.h, buffer: masterBuf };
  const plan = variantPlan(size.w, size.h);

  const webp: ProcessedPhoto['webp'] = [];
  for (const t of plan.webp) {
    const buffer = await sharp(masterBuf).resize({ width: t.w, height: t.h, fit: 'fill' }).webp({ quality: WEBP_QUALITY }).toBuffer();
    webp.push({ tier: t.tier, w: t.w, h: t.h, buffer });
  }
  const jpeg: EncodedFile = {
    w: plan.jpeg.w,
    h: plan.jpeg.h,
    buffer: await jpegOut(sharp(masterBuf).resize({ width: plan.jpeg.w, height: plan.jpeg.h, fit: 'fill' }), JPEG_QUALITY),
  };
  const c = plan.og.crop;
  const og: EncodedFile = {
    w: plan.og.w,
    h: plan.og.h,
    buffer: await jpegOut(
      sharp(masterBuf).extract({ left: c.x, top: c.y, width: c.w, height: c.h }).resize({ width: plan.og.w, height: plan.og.h, fit: 'fill' }),
      OG_QUALITY,
    ),
  };

  // Sanity checks: real decoded dimensions, no EXIF anywhere, no tier wider than the master.
  const checks: Array<[string, EncodedFile]> = [['master', master], ['jpeg', jpeg], ['og', og], ...webp.map((x): [string, EncodedFile] => [`webp${x.tier}`, x])];
  for (const [name, f] of checks) {
    const d = await dimsOf(f.buffer);
    if (Math.abs(d.w - f.w) > 1 || Math.abs(d.h - f.h) > 1) throw new ImageError(`${name}: decoded ${d.w}x${d.h}, expected ${f.w}x${f.h}`);
    if (await hasExif(f.buffer)) throw new ImageError(`${name}: output still carries EXIF`);
    if (f.w > master.w) throw new ImageError(`${name}: wider than the master`);
  }

  const variants: PhotoVariants = {
    master: { w: master.w, h: master.h, bytes: master.buffer.length },
    webp: webp.map((x) => ({ tier: x.tier as PhotoVariants['webp'][number]['tier'], w: x.w, h: x.h, bytes: x.buffer.length })),
    jpeg: { w: jpeg.w, h: jpeg.h, bytes: jpeg.buffer.length },
    og: { w: og.w, h: og.h, bytes: og.buffer.length },
  };
  if (!variantsMatchPlan(variants, master.w, master.h)) throw new ImageError('variants do not match the variant plan');

  return { master, webp, jpeg, og, dominantColor: await dominantColorOf(masterBuf), variants, bytesTotal: sumBytes(variants) };
}
