/** Variant assembly: turns encoded blobs into the EncodedPhoto the queue uploads, checked against the plan first. */
import { PhotoVariantsSchema, planUploadFiles, variantsMatchPlan, type PhotoVariants, type WebpTier } from '@mp/shared';
import type { EncodedFile, EncodedPhoto } from '../upload/types';
import { EncodeError } from './errors';

export interface EncodedPart {
  w: number;
  h: number;
  blob: Blob;
}

export interface EncodedParts {
  master: EncodedPart;
  webp: Array<EncodedPart & { tier: WebpTier }>;
  jpeg: EncodedPart;
  og: EncodedPart;
}

/** Only the kinds and tiers of the plan matter here, so any valid id does. */
const PLAN_ID = '00000000-0000-4000-8000-000000000000';

const dims = (p: EncodedPart) => ({ w: p.w, h: p.h, bytes: p.blob.size });

/**
 * Builds variants + files and verifies, before anything touches the network, that the variants match variantPlan and
 * that the files are exactly planUploadFiles. Throws EncodeError('PLAN_MISMATCH') otherwise; never returns a partial set.
 */
export function assembleEncodedPhoto(
  parts: EncodedParts,
  width: number,
  height: number,
  dominantColor?: string,
): EncodedPhoto {
  const variants: PhotoVariants = {
    master: dims(parts.master),
    webp: parts.webp.map((e) => ({ tier: e.tier, ...dims(e) })),
    jpeg: dims(parts.jpeg),
    og: dims(parts.og),
  };
  if (!PhotoVariantsSchema.safeParse(variants).success || !variantsMatchPlan(variants, width, height)) {
    throw new EncodeError('PLAN_MISMATCH', 'variants differ from the plan');
  }
  const files: EncodedFile[] = [
    { kind: 'master', body: parts.master.blob, bytes: parts.master.blob.size },
    ...parts.webp.map((e) => ({ kind: 'webp' as const, tier: e.tier, body: e.blob, bytes: e.blob.size })),
    { kind: 'jpeg', body: parts.jpeg.blob, bytes: parts.jpeg.blob.size },
    { kind: 'og', body: parts.og.blob, bytes: parts.og.blob.size },
  ];
  const key = (f: { kind: string; tier?: number | undefined }) => `${f.kind}:${f.tier ?? ''}`;
  const wanted = planUploadFiles(PLAN_ID, width, height).map(key).sort();
  const got = files.map(key).sort();
  if (wanted.length !== got.length || wanted.some((k, i) => k !== got[i])) {
    throw new EncodeError('PLAN_MISMATCH', 'files differ from the plan');
  }
  return { width, height, variants, files, ...(dominantColor === undefined ? {} : { dominantColor }) };
}
