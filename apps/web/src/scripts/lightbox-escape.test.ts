import { describe, expect, it } from 'vitest';
import {
  clampView,
  fitSize,
  identity,
  maxScale,
  pinchMove,
  pinchStart,
  settleView,
  type ZoomGeometry,
} from './lightbox-zoom-state';
import { createGestures } from './lightbox-pointer';
import { pageZoomFrame, screenPoint, type VisualViewportLike } from './lightbox-viewport';

// T-291: a user must always be able to get back to the fitted view, and the controls must stay on screen.
const stage = { width: 390, height: 844 };
const fit = fitSize(stage, { width: 3000, height: 2000 });
const g: ZoomGeometry = { stage, fit, max: maxScale(3000, fit.width) };

describe('returning to the fitted view (T-291)', () => {
  it('a pinch-out always ends at exactly fit, whatever the start zoom or pan', () => {
    for (const scale of [1.5, 2, 3, g.max]) {
      const start = pinchStart(clampView({ scale, x: 500, y: -500 }, g), { x: 100, y: 400 }, { x: 290, y: 400 });
      const view = pinchMove(start, { x: 195, y: 400 }, { x: 196, y: 400 }, g);
      expect(view).toEqual(identity);
    }
  });

  it('a pinch that stops a hair above fit snaps to fit, a real zoom is kept', () => {
    expect(settleView({ scale: 1.03, x: 4, y: 0 })).toBe(identity);
    expect(settleView({ scale: 1, x: 0, y: 0 })).toBe(identity);
    expect(settleView({ scale: Number.NaN, x: 0, y: 0 })).toBe(identity);
    const kept = { scale: 1.5, x: 10, y: 0 };
    expect(settleView(kept)).toBe(kept);
  });

  it('the gesture controller reports the end of a pinch once, also when it is cancelled', () => {
    let ends = 0;
    const gestures = createGestures({
      enabled: true,
      zoomed: true,
      pinchBegin() {},
      pinchTo() {},
      pinchEnd: () => (ends += 1),
      panByPx() {},
      toggleAt() {},
      setGesture() {},
    });
    gestures.down({ pointerId: 1, clientX: 100, clientY: 100 });
    gestures.down({ pointerId: 2, clientX: 200, clientY: 100 });
    gestures.up({ pointerId: 1, clientX: 100, clientY: 100 });
    gestures.up({ pointerId: 2, clientX: 200, clientY: 100 });
    expect(ends).toBe(1);
    gestures.down({ pointerId: 3, clientX: 100, clientY: 100 });
    gestures.down({ pointerId: 4, clientX: 200, clientY: 100 });
    gestures.cancel({ pointerId: 3, clientX: 100, clientY: 100 });
    expect(ends).toBe(2);
  });
});

describe('page pinch zoom keeps the controls reachable (T-291)', () => {
  const zoomed: VisualViewportLike = { scale: 2.5, offsetLeft: 120, offsetTop: 300, width: 156, height: 337.6 };

  it('does nothing when the page is not zoomed or the numbers are unusable', () => {
    expect(pageZoomFrame({ ...zoomed, scale: 1 })).toBeNull();
    expect(pageZoomFrame({ ...zoomed, scale: 1.005 })).toBeNull();
    expect(pageZoomFrame({ ...zoomed, scale: Number.NaN })).toBeNull();
    expect(pageZoomFrame({ ...zoomed, width: 0 })).toBeNull();
  });

  it('sizes the dialog to the layout viewport and counter-scales it', () => {
    const f = pageZoomFrame(zoomed)!;
    expect(f.width).toBeCloseTo(390);
    expect(f.height).toBeCloseTo(844);
    expect(f.factor).toBeCloseTo(0.4);
    expect(f.x).toBe(120);
    expect(f.y).toBe(300);
  });

  it('puts the top right corner (the close button) on the top right of the visible window', () => {
    const f = pageZoomFrame(zoomed)!;
    const topRight = screenPoint(f, f.width, 0, zoomed);
    expect(topRight.x).toBeCloseTo(390);
    expect(topRight.y).toBeCloseTo(0);
    const bottomLeft = screenPoint(f, 0, f.height, zoomed);
    expect(bottomLeft.x).toBeCloseTo(0);
    expect(bottomLeft.y).toBeCloseTo(844);
  });
});
