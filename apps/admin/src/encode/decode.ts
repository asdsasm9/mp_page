/** Decode step: size and format checks around the injected SurfaceFactory.decode (plan 4.7, 4.8). */
import type { FileLike } from '../upload/types';
import { EncodeAbortedError, EncodeError, throwIfAborted } from './errors';
import { assertPixels, detectTouch, guardInput } from './inputGuard';
import type { Drawable, SurfaceFactory } from './surface';

const HEIC_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);

/** HEIC/HEIF by MIME type or extension (browsers often leave the type empty for HEIC). */
export function isHeic(file: FileLike): boolean {
  return HEIC_TYPES.has(file.type.toLowerCase()) || /\.(heic|heif)$/i.test(file.name);
}

/**
 * Refuses by file size and header dimensions before decoding (guardInput), decodes with EXIF orientation applied and
 * checks the decoded pixels again (formats the sniffer does not know). The limit is 64 MP, 40 MP on touch devices.
 * HEIC is only attempted through the browser's own decoder; when that fails the HEIC message replaces the generic one.
 * Decoding at a reduced size (createImageBitmap resizeWidth/Height) is deliberately not used: it cannot be tested
 * without a real browser and risks wrong orientation for EXIF-rotated photos.
 */
export async function decodeImage(
  factory: SurfaceFactory,
  file: FileLike,
  signal: AbortSignal,
  touch: boolean = detectTouch(),
): Promise<Drawable> {
  throwIfAborted(signal);
  const heic = isHeic(file);
  await guardInput(file, touch);
  throwIfAborted(signal);
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
  try {
    assertPixels(width, height, touch);
  } catch (error) {
    image.close();
    throw error;
  }
  if (signal.aborted) {
    image.close();
    throw new EncodeAbortedError();
  }
  return image;
}
