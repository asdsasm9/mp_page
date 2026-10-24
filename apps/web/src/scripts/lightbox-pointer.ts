/**
 * Pointer gestures of the lightbox zoom (no DOM): two-pointer pinch, one-pointer drag pan while zoomed, and
 * touch double-tap (dblclick is unreliable on touch). It only tracks pointers and calls the host; the math and the
 * clamping live in lightbox-zoom-state.ts via lightbox-zoom.ts. lightbox.ts attaches the listeners once.
 */
import type { Point } from './lightbox-zoom-state';

/** A second tap counts as a double tap when it starts within this time of the first tap's end... */
export const DOUBLE_TAP_MS = 300;
/** ...and within this distance (CSS px) of the first tap. */
export const DOUBLE_TAP_DISTANCE = 30;
/** A press that moves more than this is a drag, not a tap. */
export const TAP_SLOP = 10;
/** A press held longer than this is not a tap. */
export const TAP_MAX_MS = 300;

export interface PointerLike {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerType?: string;
  readonly button?: number;
}

/** What the controller needs from the zoom controller. */
export interface GestureHost {
  readonly enabled: boolean;
  readonly zoomed: boolean;
  pinchBegin(a: Point, b: Point): void;
  pinchTo(a: Point, b: Point): void;
  /** The pinch is over (finger lifted or cancelled); optional so older hosts keep working. */
  pinchEnd?(): void;
  panByPx(dx: number, dy: number): void;
  toggleAt(x: number, y: number): void;
  /** Gesture in progress (true) or over (false): the page drops the transform transition meanwhile. */
  setGesture(on: boolean): void;
}

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export function createGestures(host: GestureHost, now: () => number = () => performance.now()) {
  const pointers = new Map<number, Point>();
  let single: { id: number; start: Point; at: number; moved: boolean } | null = null;
  let lastTap: { at: number; point: Point } | null = null;
  let pinching = false;
  let lastDoubleTap = -Infinity;

  const pair = (): [Point, Point] | null => {
    const [a, b] = [...pointers.values()];
    return a && b ? [a, b] : null;
  };

  function endPinch(): void {
    if (pinching) host.pinchEnd?.();
    pinching = false;
  }

  function settle(): void {
    if (pointers.size === 0) host.setGesture(false);
  }

  return {
    down(e: PointerLike): void {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const p = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, p);
      if (pointers.size === 1) {
        single = { id: e.pointerId, start: p, at: now(), moved: false };
        if (host.zoomed) host.setGesture(true);
      } else if (pointers.size === 2 && host.enabled) {
        single = null; // a second finger cancels any tap
        lastTap = null;
        const both = pair()!;
        pinching = true;
        host.setGesture(true);
        host.pinchBegin(both[0], both[1]);
      } else {
        single = null;
      }
    },
    move(e: PointerLike): void {
      if (!pointers.has(e.pointerId)) return;
      const before = pointers.get(e.pointerId)!;
      const p = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, p);
      if (pinching) {
        const both = pair();
        if (both) host.pinchTo(both[0], both[1]);
        return;
      }
      if (!single || single.id !== e.pointerId) return;
      if (dist(p, single.start) > TAP_SLOP) single.moved = true;
      if (host.zoomed) {
        host.setGesture(true);
        host.panByPx(p.x - before.x, p.y - before.y);
      }
    },
    /** Pointer released. Returns true when it completed a double tap (the caller then ignores the dblclick). */
    up(e: PointerLike): boolean {
      if (!pointers.has(e.pointerId)) return false;
      const p = { x: e.clientX, y: e.clientY };
      pointers.delete(e.pointerId);
      const wasPinching = pinching;
      if (wasPinching && pointers.size < 2) endPinch();
      let doubled = false;
      const s = single;
      if (s && s.id === e.pointerId) {
        single = null;
        const t = now();
        const isTap = !s.moved && t - s.at <= TAP_MAX_MS && e.pointerType !== 'mouse';
        if (isTap) {
          if (lastTap && t - lastTap.at <= DOUBLE_TAP_MS && dist(p, lastTap.point) <= DOUBLE_TAP_DISTANCE) {
            lastTap = null;
            lastDoubleTap = t;
            doubled = true;
            if (host.enabled) host.toggleAt(p.x, p.y);
          } else {
            lastTap = { at: t, point: p };
          }
        } else {
          lastTap = null;
        }
      }
      // One finger left after a pinch continues as a pan from where it is, and is never a tap.
      if (wasPinching && pointers.size === 1) {
        const [id] = [...pointers.keys()];
        single = { id: id!, start: pointers.get(id!)!, at: now(), moved: true };
      }
      settle();
      return doubled;
    },
    /** pointercancel / lostpointercapture / pointerleave of a captured pointer: like up, but never a tap. */
    cancel(e: PointerLike): void {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (single && single.id === e.pointerId) single = null;
      lastTap = null;
      if (pinching && pointers.size < 2) endPinch();
      if (pointers.size === 1) {
        const [id] = [...pointers.keys()];
        single = { id: id!, start: pointers.get(id!)!, at: now(), moved: true };
      }
      settle();
    },
    /** Photo change / close: forget everything. */
    reset(): void {
      pointers.clear();
      single = null;
      lastTap = null;
      pinching = false;
      host.setGesture(false);
    },
    /** True within 600 ms of a handled touch double tap; the browser's own dblclick must not toggle again. */
    recentlyDoubleTapped: (): boolean => now() - lastDoubleTap < 600,
    get active(): number {
      return pointers.size;
    },
  };
}
