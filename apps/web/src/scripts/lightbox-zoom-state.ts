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

const positive = (n: number): boolean => Number.isFinite(n) && n > 0;

/**
 * The largest box with the photo's aspect ratio that fits inside the stage (it scales the photo up or down to
 * touch the stage on one axis, whatever the photo's own pixel size is). 0 x 0 for any non-finite or non-positive size.
 */
export function fitSize(stage: Size, photo: Size): Size {
  if (!positive(stage.width) || !positive(stage.height) || !positive(photo.width) || !positive(photo.height)) {
    return { width: 0, height: 0 };
  }
  const k = Math.min(stage.width / photo.width, stage.height / photo.height);
  return { width: photo.width * k, height: photo.height * k };
}

/** Largest scale: min(4, master width / fit width in CSS px). 1 when the geometry is degenerate or non-finite. */
export function maxScale(masterWidth: number, fitCssWidth: number): number {
  if (!positive(masterWidth) || !positive(fitCssWidth)) return 1;
  return Math.max(1, Math.min(MAX_SCALE_LIMIT, masterWidth / fitCssWidth));
}

/** Zoom is only offered when the master has at least ~10 % more pixels than the fit box shows. */
export const zoomEnabled = (max: number): boolean => max >= MIN_HEADROOM;

/** 1..max; a non-finite scale (NaN, Infinity) is treated as fit, a non-finite max as 1. */
export const clampScale = (scale: number, max: number): number =>
  Number.isFinite(scale) ? Math.min(Math.max(scale, 1), Math.max(1, Number.isFinite(max) ? max : 1)) : 1;

/** Largest |translation| per axis at `scale`: half of the overflow of the scaled image over the stage. */
function limits(scale: number, g: ZoomGeometry): Point {
  return {
    x: Math.max(0, (g.fit.width * scale - g.stage.width) / 2),
    y: Math.max(0, (g.fit.height * scale - g.stage.height) / 2),
  };
}

const clampAbs = (v: number, limit: number): number => (Number.isFinite(v) ? Math.min(Math.max(v, -limit), limit) : 0);

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
  // A non-finite pointer position falls back to the stage centre rather than poisoning the view with NaN.
  const p = Number.isFinite(at.x) && Number.isFinite(at.y) ? at : { x: 0, y: 0 };
  return clampView({ scale: next, x: p.x - (p.x - view.x) * ratio, y: p.y - (p.y - view.y) * ratio }, g);
}

/** One button / key step: `dir` +1 zooms in, -1 out, around `at` (default the stage centre). */
export function zoomStep(view: ZoomView, dir: 1 | -1, g: ZoomGeometry, at: Point = { x: 0, y: 0 }): ZoomView {
  const factor = dir > 0 ? STEP_FACTOR : 1 / STEP_FACTOR;
  const target = view.scale * factor;
  // A step out that would end below 1.05 snaps to exactly fit; a step in past max is clamped to exactly max by zoomAt.
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

/** A scale this close to fit is fit: the end of a pinch (or any gesture) never leaves a sliver of zoom behind. */
export const SNAP_TO_FIT = 1.05;
export const settleView = (view: ZoomView): ZoomView => (!(view.scale >= SNAP_TO_FIT) ? identity : view);

/** A photo change always starts at fit. */
export const resetOnPhotoChange = (): ZoomView => identity;

export const canZoomIn = (view: ZoomView, g: ZoomGeometry): boolean => zoomEnabled(g.max) && view.scale < g.max - 1e-9;
export const canZoomOut = (view: ZoomView): boolean => view.scale > 1 + 1e-9;
export const isZoomed = (view: ZoomView): boolean => view.scale > 1 + 1e-9;

/** Whole-percent level for the polite status text ("Přiblížení 150 %"). */
export const zoomPercent = (view: ZoomView): number => Math.round(view.scale * 100);

/**
 * Scale factor of one wheel event (ctrl+wheel is how a trackpad pinch arrives): exp(-delta/100), pixels; lines and
 * pages are converted first. Bounded to 0.5..2 per event so one odd delta cannot jump the zoom; 1 for non-finite.
 */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY)) return 1;
  const px = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
  return Math.min(2, Math.max(0.5, Math.exp(-px / 100)));
}

/** One arrow-key pan step: 20 % of the smaller stage side. */
export const PAN_STEP_RATIO = 0.2;
export const panStep = (stage: Size): number => Math.round(Math.min(stage.width, stage.height) * PAN_STEP_RATIO);

/** Image point (relative to the image centre, unscaled CSS px) under a stage point; used to verify "fixed point". */
export function imagePointAt(view: ZoomView, at: Point): Point {
  return { x: (at.x - view.x) / view.scale, y: (at.y - view.y) / view.scale };
}
