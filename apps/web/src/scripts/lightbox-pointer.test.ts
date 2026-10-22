import { describe, expect, it } from 'vitest';
import { createGestures, type GestureHost, type PointerLike } from './lightbox-pointer';
import { PAN_STEP_RATIO, panStep, wheelFactor } from './lightbox-zoom-state';

function setup(opts: { zoomed?: boolean; enabled?: boolean } = {}) {
  const calls: string[] = [];
  const host: GestureHost & { zoomed: boolean; enabled: boolean } = {
    enabled: opts.enabled ?? true,
    zoomed: opts.zoomed ?? false,
    pinchBegin: (a, b) => calls.push(`begin ${a.x},${a.y} ${b.x},${b.y}`),
    pinchTo: (a, b) => calls.push(`to ${a.x},${a.y} ${b.x},${b.y}`),
    panByPx: (dx, dy) => calls.push(`pan ${dx},${dy}`),
    toggleAt: (x, y) => calls.push(`toggle ${x},${y}`),
    setGesture: (on) => calls.push(`gesture ${on}`),
  };
  let t = 1000;
  const g = createGestures(host, () => t);
  return {
    g,
    host,
    calls,
    advance: (ms: number) => void (t += ms),
  };
}

const ptr = (pointerId: number, clientX: number, clientY: number, pointerType = 'touch'): PointerLike => ({
  pointerId,
  clientX,
  clientY,
  pointerType,
  button: 0,
});

describe('pinch', () => {
  it('two pointers start a pinch and every move reports both points', () => {
    const { g, calls } = setup();
    g.down(ptr(1, 100, 100));
    g.down(ptr(2, 200, 100));
    g.move(ptr(2, 300, 100));
    expect(calls).toEqual(['gesture true', 'begin 100,100 200,100', 'to 100,100 300,100']);
  });

  it('is ignored when zoom is not enabled for the photo', () => {
    const { g, calls } = setup({ enabled: false });
    g.down(ptr(1, 100, 100));
    g.down(ptr(2, 200, 100));
    g.move(ptr(2, 300, 100));
    expect(calls).toEqual([]);
  });

  it('a lifted finger leaves the other one panning, never tapping', () => {
    const { g, host, calls } = setup({ zoomed: true });
    g.down(ptr(1, 100, 100));
    g.down(ptr(2, 200, 100));
    g.up(ptr(2, 200, 100));
    calls.length = 0;
    g.move(ptr(1, 110, 100));
    expect(calls).toEqual(['gesture true', 'pan 10,0']);
    host.zoomed = true;
    expect(g.up(ptr(1, 110, 100))).toBe(false);
    expect(calls).not.toContain('toggle 110,100');
  });
});

describe('drag pan', () => {
  it('pans by the pointer delta only while zoomed', () => {
    const z = setup({ zoomed: true });
    z.g.down(ptr(1, 50, 50));
    z.g.move(ptr(1, 70, 45));
    z.g.move(ptr(1, 75, 45));
    expect(z.calls.filter((c) => c.startsWith('pan'))).toEqual(['pan 20,-5', 'pan 5,0']);
    const f = setup({ zoomed: false });
    f.g.down(ptr(1, 50, 50));
    f.g.move(ptr(1, 90, 50));
    expect(f.calls.some((c) => c.startsWith('pan'))).toBe(false);
  });

  it('ignores a non-primary mouse button and moves of unknown pointers', () => {
    const { g, calls } = setup({ zoomed: true });
    g.down({ ...ptr(1, 0, 0, 'mouse'), button: 2 });
    g.move(ptr(1, 30, 0, 'mouse'));
    g.move(ptr(9, 30, 0));
    expect(calls).toEqual([]);
    expect(g.active).toBe(0);
  });
});

describe('double tap', () => {
  const tap = (s: ReturnType<typeof setup>, x: number, y: number, hold = 40) => {
    s.g.down(ptr(1, x, y));
    s.advance(hold);
    return s.g.up(ptr(1, x, y));
  };

  it('two quick taps close together toggle at the second tap', () => {
    const s = setup();
    expect(tap(s, 100, 100)).toBe(false);
    s.advance(120);
    expect(tap(s, 110, 105)).toBe(true);
    expect(s.calls).toContain('toggle 110,105');
    expect(s.g.recentlyDoubleTapped()).toBe(true);
    s.advance(700);
    expect(s.g.recentlyDoubleTapped()).toBe(false);
  });

  it('too slow (over 300 ms) or too far (over 30 px) is two single taps', () => {
    const slow = setup();
    tap(slow, 100, 100);
    slow.advance(400);
    expect(tap(slow, 100, 100)).toBe(false);
    const far = setup();
    tap(far, 100, 100);
    far.advance(100);
    expect(tap(far, 140, 100)).toBe(false);
    expect(slow.calls.concat(far.calls).some((c) => c.startsWith('toggle'))).toBe(false);
  });

  it('a drag between the taps, a long press or a mouse click is not a tap', () => {
    const s = setup();
    tap(s, 100, 100);
    s.g.down(ptr(1, 100, 100));
    s.g.move(ptr(1, 140, 100));
    s.g.up(ptr(1, 140, 100));
    s.advance(50);
    expect(tap(s, 100, 100)).toBe(false);
    const long = setup();
    tap(long, 100, 100);
    long.advance(50);
    expect(tap(long, 100, 100, 600)).toBe(false);
    const mouse = setup();
    mouse.g.down(ptr(1, 100, 100, 'mouse'));
    mouse.g.up(ptr(1, 100, 100, 'mouse'));
    mouse.g.down(ptr(1, 100, 100, 'mouse'));
    expect(mouse.g.up(ptr(1, 100, 100, 'mouse'))).toBe(false);
  });

  it('does not toggle when zoom is not enabled but still reports the double tap', () => {
    const s = setup({ enabled: false });
    tap(s, 100, 100);
    s.advance(100);
    expect(tap(s, 100, 100)).toBe(true);
    expect(s.calls.some((c) => c.startsWith('toggle'))).toBe(false);
  });
});

describe('cancel and reset', () => {
  it('pointercancel drops the pointer, ends the gesture and is never a tap', () => {
    const s = setup();
    s.g.down(ptr(1, 100, 100));
    s.g.cancel(ptr(1, 100, 100));
    expect(s.g.active).toBe(0);
    expect(s.calls.at(-1)).toBe('gesture false');
    s.advance(50);
    s.g.down(ptr(1, 100, 100));
    s.advance(30);
    expect(s.g.up(ptr(1, 100, 100))).toBe(false);
  });

  it('cancel during a pinch stops pinch updates', () => {
    const s = setup();
    s.g.down(ptr(1, 100, 100));
    s.g.down(ptr(2, 200, 100));
    s.g.cancel(ptr(2, 200, 100));
    s.calls.length = 0;
    s.g.move(ptr(1, 150, 100));
    expect(s.calls.some((c) => c.startsWith('to'))).toBe(false);
  });

  it('reset forgets all pointers, so nothing carries over to the next photo', () => {
    const s = setup({ zoomed: true });
    s.g.down(ptr(1, 100, 100));
    s.g.down(ptr(2, 200, 100));
    s.g.reset();
    expect(s.g.active).toBe(0);
    s.calls.length = 0;
    s.g.move(ptr(1, 150, 100));
    s.g.up(ptr(2, 200, 100));
    expect(s.calls).toEqual([]);
  });
});

describe('wheel and pan step math', () => {
  it('ctrl+wheel up zooms in, down zooms out, bounded per event', () => {
    expect(wheelFactor(-10)).toBeGreaterThan(1);
    expect(wheelFactor(10)).toBeLessThan(1);
    expect(wheelFactor(-100000)).toBe(2);
    expect(wheelFactor(100000)).toBe(0.5);
    expect(wheelFactor(Number.NaN)).toBe(1);
    expect(wheelFactor(0)).toBe(1);
    expect(wheelFactor(-1, 1)).toBeCloseTo(Math.exp(0.16), 6); // lines are 16 px
  });

  it('arrow-key pan step is a fifth of the smaller side', () => {
    expect(panStep({ width: 1000, height: 800 })).toBe(Math.round(800 * PAN_STEP_RATIO));
    expect(panStep({ width: 375, height: 800 })).toBe(75);
  });
});
