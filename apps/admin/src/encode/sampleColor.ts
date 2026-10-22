/** Canvas helper: downscale to 16x16 through the surface and compute the dominant colour. */
import { dominantColorOf, SAMPLE_EDGE } from './dominantColor';
import { resizeTo } from './resize';
import type { Drawable, SurfaceFactory } from './surface';

export function sampleDominantColor(factory: SurfaceFactory, src: Drawable, signal?: AbortSignal): string {
  const small = resizeTo(factory, src, { x: 0, y: 0, w: src.width, h: src.height }, SAMPLE_EDGE, SAMPLE_EDGE, signal);
  try {
    return dominantColorOf(small.getRgba());
  } finally {
    small.close();
  }
}
