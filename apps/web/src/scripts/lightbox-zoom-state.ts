/**
 * Pure zoom and pan math of the album lightbox (no DOM). lightbox-zoom.ts applies the result as
 * `translate(x px, y px) scale(scale)` with the transform origin at the centre of the image box.
 *
 * Coordinates: every point is in CSS px relative to the CENTRE of the stage (the zoom area), x to the right,
 * y downwards. `scale` 1 is the fit size (the whole photo inside the stage); `x`/`y` is the translation of
 * the image centre. Zooming at a point keeps the photo pixel under that point where it is (within 1 px,
 * unless the pan clamp has to move it so no edge is exposed).
 */
export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface ZoomView {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

/** Everything the math needs: the stage, the fitted image box (scale 1) and the largest allowed scale. */
export interface ZoomGeometry {
  readonly stage: Size;
  readonly fit: Size;
  readonly max: number;
}

/** Hard upper limit of the zoom, whatever the master resolution is. */
export const MAX_SCALE_LIMIT = 4;
/** Zoom is disabled when the master gives less headroom than this over the fit size. */
export const MIN_HEADROOM = 1.1;
/** Scale of a double click / double tap, and of the factor of one button step. */
export const DOUBLE_TAP_SCALE = 2;
export const STEP_FACTOR = 1.5;

export const identity: ZoomView = { scale: 1, x: 0, y: 0 };

/** The photo (width x height, any unit) contained in the stage, never enlarged past its own size ratio. */
export function fitSize(stage: Size, photo: Size): Size {
  if (stage.width <= 0 || stage.height <= 0 || photo.width <= 0 || photo.height <= 0) {
    return { width: 0, height: 0 };
  }
  const k = Math.min(stage.width / photo.width, stage.height / photo.height);
  return { width: photo.width * k, height: photo.height * k };
}

/** Largest scale: min(4, master width / fit width in CSS px). 1 when the geometry is degenerate. */
export function maxScale(masterWidth: number, fitCssWidth: number): number {
  if (!(masterWidth > 0) || !(fitCssWidth > 0)) return 1;
  return Math.max(1, Math.min(MAX_SCALE_LIMIT, masterWidth / fitCssWidth));
}

/** Zoom is only offered when the master has at least ~10 % more pixels than the fit box shows. */
export const zoomEnabled = (max: number): boolean => max >= MIN_HEADROOM;

export const clampScale = (scale: number, max: number): number => Math.min(Math.max(scale, 1), Math.max(1, max));

/** Largest |translation| per axis at `scale`: half of the overflow of the scaled image over the stage. */
function limits(scale: number, g: ZoomGeometry): Point {
  return {
    x: Math.max(0, (g.fit.width * scale - g.stage.width) / 2),
    y: Math.max(0, (g.fit.height * scale - g.stage.height) / 2),
  };
}

const clampAbs = (v: number, limit: number): number => Math.min(Math.max(v, -limit), limit);

/** Clamps scale to 1..max and the translation so no edge of the image is pulled inside the stage. */
export function clampView(view: ZoomView, g: ZoomGeometry): ZoomView {
  const scale = clampScale(view.scale, g.max);
  if (scale === 1) return identity;
  const l = limits(scale, g);
  return { scale, x: clampAbs(view.x, l.x), y: clampAbs(view.y, l.y) };
}

/** Moves the view by a pan delta in CSS px, clamped. */
export function panBy(view: ZoomView, dx: number, dy: number, g: ZoomGeometry): ZoomView {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, g);
}

/** Sets a new scale keeping the image point under `at` fixed, then clamps. */
export function zoomAt(view: ZoomView, scale: number, at: Point, g: ZoomGeometry): ZoomView {
  const next = clampScale(scale, g.max);
  const ratio = next / view.scale;
  return clampView({ scale: next, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio }, g);
}

/** One button / key step: `dir` +1 zooms in, -1 out, around `at` (default the stage centre). */
export function zoomStep(view: ZoomView, dir: 1 | -1, g: ZoomGeometry, at: Point = { x: 0, y: 0 }): ZoomView {
  const factor = dir > 0 ? STEP_FACTOR : 1 / STEP_FACTOR;
  const target = view.scale * factor;
  // Snap back to exactly fit when stepping out near 1, and to exactly max when stepping in near it.
  return zoomAt(view, target < 1.05 ? 1 : target, at, g);
}

/** Double click / double tap: zoomed -> back to fit; at fit -> 2x (or max when lower) at the pointer. */
export function toggleDoubleTap(view: ZoomView, at: Point, g: ZoomGeometry): ZoomView {
  if (view.scale > 1) return identity;
  return zoomAt(view, Math.min(DOUBLE_TAP_SCALE, g.max), at, g);
}

export interface PinchStart {
  /** View when the second finger went down. */
  readonly view: ZoomView;
  /** Distance between the two pointers then, CSS px. */
  readonly distance: number;
  /** Their midpoint then. */
  readonly midpoint: Point;
}

export const distanceOf = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export const midpointOf = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function pinchStart(view: ZoomView, a: Point, b: Point): PinchStart {
  return { view, distance: distanceOf(a, b), midpoint: midpointOf(a, b) };
}

/**
 * View for the current pointer positions: scale follows the distance ratio, and the image point that was under
 * the starting midpoint stays under the current midpoint (so a pinch also pans).
 */
export function pinchMove(start: PinchStart, a: Point, b: Point, g: ZoomGeometry): ZoomView {
  if (!(start.distance > 0)) return start.view;
  const scale = clampScale(start.view.scale * (distanceOf(a, b) / start.distance), g.max);
  const ratio = scale / start.view.scale;
  const m = midpointOf(a, b);
  return clampView(
    {
      scale,
      x: m.x - (start.midpoint.x - start.view.x) * ratio,
      y: m.y - (start.midpoint.y - start.view.y) * ratio,
    },
    g,
  );
}

/** A photo change always starts at fit. */
export const resetOnPhotoChange = (): ZoomView => identity;

export const canZoomIn = (view: ZoomView, g: ZoomGeometry): boolean => zoomEnabled(g.max) && view.scale < g.max - 1e-9;
export const canZoomOut = (view: ZoomView): boolean => view.scale > 1 + 1e-9;
export const isZoomed = (view: ZoomView): boolean => view.scale > 1 + 1e-9;

/** Whole-percent level for the polite status text ("Přiblížení 150 %"). */
export const zoomPercent = (view: ZoomView): number => Math.round(view.scale * 100);

/** Image point (relative to the image centre, unscaled CSS px) under a stage point; used to verify "fixed point". */
export function imagePointAt(view: ZoomView, at: Point): Point {
  return { x: (at.x - view.x) / view.scale, y: (at.y - view.y) / view.scale };
}
