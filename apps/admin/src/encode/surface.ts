/**
 * The drawing surface behind decode/resize. A stub implements it in tests (jsdom has no canvas); `canvasSurface.ts`
 * implements it for browsers. No surface may exceed MAX_SURFACE_EDGE per edge.
 */
import { MASTER_MAX_EDGE } from '@mp/shared';

export const MAX_SURFACE_EDGE = MASTER_MAX_EDGE;
/** Decoded images above this many pixels are refused (memory). */
export const MAX_PIXELS = 100_000_000;

/** Anything that can be drawn: a decoded image or a surface. */
export interface Drawable {
  readonly width: number;
  readonly height: number;
  close(): void;
}

export interface Rgba {
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Surface extends Drawable {
  /** Draw the `from` rectangle of `src` scaled over the whole surface. */
  drawFrom(src: Drawable, from: Rect): void;
  getRgba(): Rgba;
  toBlob(type: 'image/jpeg' | 'image/webp', quality: number): Promise<Blob>;
}

export interface SurfaceFactory {
  /** Decodes with EXIF orientation applied. Throws on undecodable input. */
  decode(file: Blob, signal: AbortSignal): Promise<Drawable>;
  /** Throws when either edge is above MAX_SURFACE_EDGE. */
  createSurface(w: number, h: number): Surface;
}

export function assertSurfaceSize(w: number, h: number): void {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > MAX_SURFACE_EDGE || h > MAX_SURFACE_EDGE) {
    throw new RangeError(`Surface ${w}x${h} outside 1..${MAX_SURFACE_EDGE}`);
  }
}
