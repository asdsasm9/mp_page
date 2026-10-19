import { describe, expect, it } from 'vitest';
import {
  canZoomIn,
  canZoomOut,
  clampView,
  fitSize,
  identity,
  imagePointAt,
  isZoomed,
  maxScale,
  panBy,
  pinchMove,
  pinchStart,
  resetOnPhotoChange,
  toggleDoubleTap,
  zoomAt,
  zoomEnabled,
  zoomPercent,
  zoomStep,
  type ZoomGeometry,
} from './lightbox-zoom-state';

const stage = { width: 1000, height: 800 };
const fit = fitSize(stage, { width: 3000, height: 2000 }); // 1000 x 666.67
const g: ZoomGeometry = { stage, fit, max: maxScale(3000, fit.width) }; // 3

describe('lightbox zoom state', () => {
  it('fits the photo inside the stage keeping the ratio', () => {
    expect(fit.width).toBeCloseTo(1000);
    expect(fit.height).toBeCloseTo(666.67, 1);
    expect(fitSize(stage, { width: 2000, height: 3000 })).toEqual({ width: 533.3333333333334, height: 800 });
    expect(fitSize({ width: 0, height: 800 }, { width: 10, height: 10 })).toEqual({ width: 0, height: 0 });
  });

  it('maxScale is min(4, master width / fit width) and never below 1', () => {
    expect(maxScale(3000, 1000)).toBe(3);
    expect(maxScale(3000, 500)).toBe(4);
    expect(maxScale(1480, 1480)).toBe(1);
    expect(maxScale(800, 1000)).toBe(1);
    expect(maxScale(3000, 0)).toBe(1);
  });

  it('disables zoom when headroom is below 1.1', () => {
    expect(zoomEnabled(maxScale(1050, 1000))).toBe(false);
    expect(zoomEnabled(maxScale(1100, 1000))).toBe(true);
    expect(canZoomIn(identity, { ...g, max: 1 })).toBe(false);
    expect(canZoomIn(identity, g)).toBe(true);
  });

  it('keeps the scale within 1..maxScale', () => {
    expect(zoomAt(identity, 10, { x: 0, y: 0 }, g).scale).toBe(3);
    expect(zoomAt(identity, 0.2, { x: 0, y: 0 }, g).scale).toBe(1);
    expect(zoomAt({ scale: 2, x: 0, y: 0 }, 0.5, { x: 0, y: 0 }, g)).toEqual(identity);
  });

  it('zooms at a point and keeps that image point fixed within 1 px', () => {
    const at = { x: 100, y: -50 };
    const before = imagePointAt(identity, at);
    const v = zoomAt(identity, 2, at, g);
    const after = imagePointAt(v, at);
    expect(Math.abs(after.x - before.x) * v.scale).toBeLessThan(1);
    expect(Math.abs(after.y - before.y) * v.scale).toBeLessThan(1);
    // A second zoom from a zoomed state keeps its point as well.
    const at2 = { x: -120, y: 30 };
    const b2 = imagePointAt(v, at2);
    const v2 = zoomAt(v, 3, at2, g);
    const a2 = imagePointAt(v2, at2);
    expect(Math.abs(a2.x - b2.x) * v2.scale).toBeLessThan(1);
    expect(Math.abs(a2.y - b2.y) * v2.scale).toBeLessThan(1);
  });

  it('clamps the pan so no edge is exposed', () => {
    const v = { scale: 2, x: 0, y: 0 };
    // Overflow x: (1000*2 - 1000)/2 = 500; y: (666.67*2 - 800)/2 = 266.67
    expect(panBy(v, 9999, 9999, g)).toEqual({ scale: 2, x: 500, y: expect.closeTo(266.67, 1) });
    expect(panBy(v, -9999, -9999, g).x).toBe(-500);
    expect(clampView({ scale: 2, x: 700, y: 0 }, g).x).toBe(500);
    // At fit there is nothing to pan.
    expect(panBy(identity, 50, 50, g)).toEqual(identity);
  });

  it('does not pan on an axis where the zoomed photo still fits inside the stage', () => {
    const flat = { stage: { width: 1000, height: 800 }, fit: { width: 1000, height: 200 }, max: 3 };
    const v = panBy({ scale: 1.5, x: 0, y: 0 }, 0, 300, flat);
    expect(v.y).toBe(0); // 200 * 1.5 = 300 < 800
    expect(panBy({ scale: 1.5, x: 0, y: 0 }, 900, 0, flat).x).toBe(250);
  });

  it('zoomAt near an edge is clamped, never exposing the outside', () => {
    const v = zoomAt(identity, 2, { x: 480, y: 0 }, g);
    expect(Math.abs(v.x)).toBeLessThanOrEqual(500);
    const out = zoomAt({ scale: 3, x: 1000, y: 0 }, 1.2, { x: 0, y: 0 }, g);
    expect(Math.abs(out.x)).toBeLessThanOrEqual((fit.width * 1.2 - stage.width) / 2 + 1e-9);
  });

  it('pinch: scale follows the distance ratio and the midpoint stays on the same image point', () => {
    const a0 = { x: -50, y: 0 };
    const b0 = { x: 50, y: 0 };
    const start = pinchStart(identity, a0, b0);
    const v = pinchMove(start, { x: -100, y: 0 }, { x: 100, y: 0 }, g);
    expect(v.scale).toBeCloseTo(2);
    expect(v.x).toBeCloseTo(0);
    // Fingers move together to the right while spreading: the content follows the midpoint.
    const moved = pinchMove(start, { x: 0, y: 0 }, { x: 200, y: 0 }, g);
    const before = imagePointAt(identity, start.midpoint);
    const after = imagePointAt(moved, { x: 100, y: 0 });
    expect(Math.abs(after.x - before.x) * moved.scale).toBeLessThan(1);
    // Pinching out is limited to 1, pinching in to max.
    expect(pinchMove(start, { x: -1, y: 0 }, { x: 1, y: 0 }, g).scale).toBe(1);
    expect(pinchMove(start, { x: -5000, y: 0 }, { x: 5000, y: 0 }, g).scale).toBe(3);
  });

  it('pinch with zero starting distance changes nothing', () => {
    const start = pinchStart(identity, { x: 5, y: 5 }, { x: 5, y: 5 });
    expect(pinchMove(start, { x: 0, y: 0 }, { x: 50, y: 0 }, g)).toBe(identity);
  });

  it('double tap toggles between fit and 2x at the pointer', () => {
    const at = { x: 200, y: 100 };
    const z = toggleDoubleTap(identity, at, g);
    expect(z.scale).toBe(2);
    const before = imagePointAt(identity, at);
    const after = imagePointAt(z, at);
    expect(Math.abs(after.x - before.x) * z.scale).toBeLessThan(1);
    expect(toggleDoubleTap(z, at, g)).toEqual(identity);
    // With less headroom than 2x the double tap goes to max.
    expect(toggleDoubleTap(identity, at, { ...g, max: 1.5 }).scale).toBe(1.5);
  });

  it('button steps zoom around the centre and snap back to fit', () => {
    const a = zoomStep(identity, 1, g);
    expect(a.scale).toBeCloseTo(1.5);
    expect(zoomStep(a, 1, g).scale).toBeCloseTo(2.25);
    expect(zoomStep(zoomStep(zoomStep(a, 1, g), 1, g), 1, g).scale).toBe(3);
    expect(zoomStep(a, -1, g)).toEqual(identity);
    expect(zoomStep(identity, -1, g)).toEqual(identity);
  });

  it('resets on photo change and reports levels', () => {
    expect(resetOnPhotoChange()).toEqual(identity);
    expect(isZoomed({ scale: 2, x: 1, y: 1 })).toBe(true);
    expect(canZoomOut(identity)).toBe(false);
    expect(canZoomOut({ scale: 1.5, x: 0, y: 0 })).toBe(true);
    expect(zoomPercent({ scale: 1.5, x: 0, y: 0 })).toBe(150);
  });
});
