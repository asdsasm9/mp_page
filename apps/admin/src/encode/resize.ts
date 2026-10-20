/** Halving-step downscale (plan 4.7): each step at most halves, so the result stays sharp without a resampling library. */
import { fitWithin } from '@mp/shared';
import { throwIfAborted } from './errors';
import { MAX_SURFACE_EDGE, type Drawable, type Rect, type Surface, type SurfaceFactory } from './surface';

/**
 * Resizes the `from` rectangle of `src` to outW x outH (never above MAX_SURFACE_EDGE). The returned surface is
 * owned by the caller; intermediate surfaces are closed. `src` itself is not closed.
 */
export function resizeTo(
  factory: SurfaceFactory,
  src: Drawable,
  from: Rect,
  outW: number,
  outH: number,
  signal?: AbortSignal,
): Surface {
  let cur: Drawable = src;
  let rect: Rect = from;
  for (;;) {
    try {
      throwIfAborted(signal);
    } catch (error) {
      if (cur !== src) cur.close();
      throw error;
    }
    let w = Math.max(outW, Math.ceil(rect.w / 2));
    let h = Math.max(outH, Math.ceil(rect.h / 2));
    // First step from a huge source: keep the intermediate surface within the cap.
    if (Math.max(w, h) > MAX_SURFACE_EDGE) {
      const fit = fitWithin(w, h, MAX_SURFACE_EDGE);
      w = Math.max(outW, fit.w);
      h = Math.max(outH, fit.h);
    }
    const next = factory.createSurface(w, h);
    try {
      next.drawFrom(cur, rect);
    } catch (error) {
      next.close();
      if (cur !== src) cur.close();
      throw error;
    }
    if (cur !== src) cur.close();
    cur = next;
    rect = { x: 0, y: 0, w, h };
    if (w === outW && h === outH) return next;
  }
}
