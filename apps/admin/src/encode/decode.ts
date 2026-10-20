/** Decode step: size and format checks around the injected SurfaceFactory.decode (plan 4.7, 4.8). */
import type { FileLike } from '../upload/types';
import { EncodeAbortedError, EncodeError, throwIfAborted } from './errors';
import { MAX_PIXELS, type Drawable, type SurfaceFactory } from './surface';

const HEIC_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);

/** HEIC/HEIF by MIME type or extension (browsers often leave the type empty for HEIC). */
export function isHeic(file: FileLike): boolean {
  return HEIC_TYPES.has(file.type.toLowerCase()) || /\.(heic|heif)$/i.test(file.name);
}

/**
 * Decodes with EXIF orientation applied and refuses images above 100 megapixels. HEIC is only attempted through the
 * browser's own decoder; when that fails the HEIC message is used instead of the generic one.
 */
export async function decodeImage(factory: SurfaceFactory, file: FileLike, signal: AbortSignal): Promise<Drawable> {
  throwIfAborted(signal);
  const heic = isHeic(file);
  let image: Drawable;
  try {
    image = await factory.decode(file as unknown as Blob, signal);
  } catch (error) {
    if (signal.aborted || error instanceof EncodeAbortedError) throw new EncodeAbortedError();
    if (error instanceof EncodeError) throw error;
    throw new EncodeError(heic ? 'HEIC_UNSUPPORTED' : 'CORRUPT', String(error));
  }
  const { width, height } = image;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    image.close();
    throw new EncodeError(heic ? 'HEIC_UNSUPPORTED' : 'CORRUPT', 'empty image');
  }
  if (width * height > MAX_PIXELS) {
    image.close();
    throw new EncodeError('TOO_LARGE', `${width}x${height}`);
  }
  if (signal.aborted) {
    image.close();
    throw new EncodeAbortedError();
  }
  return image;
}
