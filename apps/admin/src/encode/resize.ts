/** Halving-step downscale (plan 4.7): each step at most halves, so the result stays sharp without a resampling library. */
import { throwIfAborted } from './errors';
import { MAX_SURFACE_EDGE, type Drawable, type Rect, type Surface, type SurfaceFactory } from './surface';

/**
 * Resizes the `from` rectangle of `src` to outW x outH (never above MAX_SURFACE_EDGE). The returned surface is
 * owned by the caller; intermediate surfaces are closed. `src` itself is not closed.
 * A source more than 2x larger than the target (so that even the halved image would not fit a surface) is halved
 * tile by tile: each tile is halved into a surface within the cap and then drawn into its place of the result.
 */
export function resizeTo(
  factory: SurfaceFactory,
  src: Drawable,
  from: Rect,
  outW: number,
  outH: number,
  signal?: AbortSignal,
): Surface {
  if (Math.ceil(from.w / 2) > MAX_SURFACE_EDGE || Math.ceil(from.h / 2) > MAX_SURFACE_EDGE) {
    const out = factory.createSurface(outW, outH);
    try {
      drawTiled(factory, src, from, out, { x: 0, y: 0, w: outW, h: outH }, signal);
    } catch (error) {
      out.close();
      throw error;
    }
    return out;
  }
  let cur: Drawable = src;
  let rect: Rect = from;
  for (;;) {
    try {
      throwIfAborted(signal);
    } catch (error) {
      if (cur !== src) cur.close();
      throw error;
    }
    const w = Math.max(outW, Math.ceil(rect.w / 2));
    const h = Math.max(outH, Math.ceil(rect.h / 2));
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

/** Draws `from` of `src` into `to` of `target`, halving first whenever the ratio is above 2. */
function drawTiled(factory: SurfaceFactory, src: Drawable, from: Rect, target: Surface, to: Rect, signal?: AbortSignal): void {
  throwIfAborted(signal);
  const ratio = Math.max(from.w / to.w, from.h / to.h);
  if (ratio <= 2) {
    target.drawFrom(src, from, to);
    return;
  }
  const halfW = Math.ceil(from.w / 2);
  const halfH = Math.ceil(from.h / 2);
  if (halfW <= MAX_SURFACE_EDGE && halfH <= MAX_SURFACE_EDGE) {
    const tmp = factory.createSurface(halfW, halfH);
    try {
      tmp.drawFrom(src, from);
      drawTiled(factory, tmp, { x: 0, y: 0, w: halfW, h: halfH }, target, to, signal);
    } finally {
      tmp.close();
    }
    return;
  }
  // Too big to halve in one surface: split along the longer source axis (and the matching target side).
  const alongX = from.w >= from.h;
  const size = alongX ? to.w : to.h;
  if (size < 2) {
    target.drawFrom(src, from, to); // cannot split a 1 px target; draw directly
    return;
  }
  const toFirst = Math.floor(size / 2);
  const fromSize = alongX ? from.w : from.h;
  const fromFirst = Math.max(1, Math.min(fromSize - 1, Math.round((fromSize * toFirst) / size)));
  if (alongX) {
    drawTiled(factory, src, { ...from, w: fromFirst }, target, { ...to, w: toFirst }, signal);
    drawTiled(factory, src, { ...from, x: from.x + fromFirst, w: from.w - fromFirst }, target, { ...to, x: to.x + toFirst, w: to.w - toFirst }, signal);
  } else {
    drawTiled(factory, src, { ...from, h: fromFirst }, target, { ...to, h: toFirst }, signal);
    drawTiled(factory, src, { ...from, y: from.y + fromFirst, h: from.h - fromFirst }, target, { ...to, y: to.y + toFirst, h: to.h - toFirst }, signal);
  }
}
