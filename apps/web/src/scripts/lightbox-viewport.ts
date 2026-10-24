/**
 * Browser pinch zoom of the PAGE (not the lightbox's own photo zoom), pure math without DOM.
 *
 * The dialog is fixed to the layout viewport. When the page itself is pinch-zoomed (visualViewport.scale > 1) the
 * visible part is a smaller window inside it, so controls pinned to the dialog corners (the close button above all)
 * would sit off screen and the user is stuck. `pageZoomFrame` gives the box the dialog must take so that it covers
 * exactly what the user sees again at 1:1: the dialog is sized to the layout viewport, moved to the visual
 * viewport's offset and scaled by 1 / scale from its top left corner.
 */
export interface VisualViewportLike {
  readonly scale: number;
  readonly offsetLeft: number;
  readonly offsetTop: number;
  /** Visible size in CSS px (shrinks as the page zooms in). */
  readonly width: number;
  readonly height: number;
}

export interface PageZoomFrame {
  /** Dialog box size in CSS px: the layout viewport. */
  readonly width: number;
  readonly height: number;
  /** Translation of the dialog's top left corner to the visible window, CSS px. */
  readonly x: number;
  readonly y: number;
  /** Counter scale (1 / page scale). */
  readonly factor: number;
}

/** Below this the page counts as not zoomed (rounding noise, rubber-banding). */
export const PAGE_ZOOM_EPSILON = 1.01;

const finite = (n: number): boolean => Number.isFinite(n);

/** The frame that keeps the dialog's controls inside the visible window, or null when the page is not zoomed. */
export function pageZoomFrame(vv: VisualViewportLike): PageZoomFrame | null {
  if (![vv.scale, vv.offsetLeft, vv.offsetTop, vv.width, vv.height].every(finite)) return null;
  if (!(vv.scale > PAGE_ZOOM_EPSILON) || !(vv.width > 0) || !(vv.height > 0)) return null;
  return {
    width: vv.width * vv.scale,
    height: vv.height * vv.scale,
    x: vv.offsetLeft,
    y: vv.offsetTop,
    factor: 1 / vv.scale,
  };
}

/** Where a dialog corner lands on screen (CSS px of the visible window) under a frame; used by tests. */
export function screenPoint(frame: PageZoomFrame, dialogX: number, dialogY: number, vv: VisualViewportLike): { x: number; y: number } {
  return {
    x: (frame.x + dialogX * frame.factor - vv.offsetLeft) * vv.scale,
    y: (frame.y + dialogY * frame.factor - vv.offsetTop) * vv.scale,
  };
}
