/**
 * Instagram avatar: decodes a picked image (EXIF orientation applied by the surface factory), centre-crops it to a
 * square, scales it to `size` x `size` and encodes one WebP (WP-16). Reuses the decode guard and the canvas surface of
 * the photo encoder; tests inject a stub factory because jsdom has no canvas.
 */
import { IG_AVATAR_MAX_BYTES, IG_AVATAR_PX } from '@mp/shared';
import { cs } from '../i18n/cs';
import { createCanvasSurfaceFactory } from './canvasSurface';
import { decodeImage } from './decode';
import { EncodeAbortedError, EncodeError } from './errors';
import type { SurfaceFactory } from './surface';

/** Largest picked file the avatar flow reads (a phone photo is far below it). */
export const AVATAR_INPUT_MAX_BYTES = 25 * 1024 * 1024;
export const AVATAR_WEBP_QUALITY = 0.85;

export type AvatarCropCode = 'NOT_IMAGE' | 'INPUT_TOO_LARGE' | 'DECODE_FAILED' | 'NOT_WEBP' | 'TOO_BIG';

const TEXT: Record<AvatarCropCode, string> = {
  NOT_IMAGE: cs.instagram.profile.dialog.cropNotImage,
  INPUT_TOO_LARGE: cs.instagram.profile.dialog.cropInputTooLarge,
  DECODE_FAILED: cs.instagram.profile.dialog.cropDecodeFailed,
  NOT_WEBP: cs.instagram.profile.dialog.cropNotWebp,
  TOO_BIG: cs.instagram.profile.dialog.cropTooBig,
};

export class AvatarCropError extends Error {
  readonly userMessage: string;
  constructor(
    readonly code: AvatarCropCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'AvatarCropError';
    this.userMessage = TEXT[code];
  }
}

/** Signature the dialog uses; tests provide a stub through AppProviders. */
export type CropAvatar = (file: File) => Promise<Blob>;

/** The app's cropper: the canvas, 480 px. */
export const cropAvatarFile: CropAvatar = (file) => cropSquareWebp(file);

export async function cropSquareWebp(
  file: File,
  size: number = IG_AVATAR_PX,
  factory: SurfaceFactory = createCanvasSurfaceFactory(),
): Promise<Blob> {
  if (!file.type.toLowerCase().startsWith('image/')) throw new AvatarCropError('NOT_IMAGE', file.type || 'no type');
  if (file.size > AVATAR_INPUT_MAX_BYTES) throw new AvatarCropError('INPUT_TOO_LARGE', `${file.size} bytes`);
  const signal = new AbortController().signal;
  let image;
  try {
    image = await decodeImage(factory, file, signal);
  } catch (error) {
    if (error instanceof EncodeAbortedError) throw error;
    if (error instanceof EncodeError && error.code === 'TOO_LARGE') throw new AvatarCropError('INPUT_TOO_LARGE', error.message);
    throw new AvatarCropError('DECODE_FAILED', String(error));
  }
  try {
    const side = Math.min(image.width, image.height);
    const from = { x: Math.floor((image.width - side) / 2), y: Math.floor((image.height - side) / 2), w: side, h: side };
    const surface = factory.createSurface(size, size);
    try {
      surface.drawFrom(image, from);
      const blob = await surface.toBlob('image/webp', AVATAR_WEBP_QUALITY);
      if (blob.type !== 'image/webp') throw new AvatarCropError('NOT_WEBP', blob.type || 'no type');
      if (blob.size > IG_AVATAR_MAX_BYTES) throw new AvatarCropError('TOO_BIG', `${blob.size} bytes`);
      return blob;
    } finally {
      surface.close();
    }
  } finally {
    image.close();
  }
}
