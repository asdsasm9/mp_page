/**
 * Input guard (WP-10 step 5, plan 3.6): refuses a picked file from its size and the dimensions in its header, before
 * anything is decoded, encoded or sent. Pure: no DOM except the optional Blob read in `readHeader`.
 */
import { MAX_INPUT_FILE_BYTES, MAX_INPUT_MEGAPIXELS_DESKTOP, MAX_INPUT_MEGAPIXELS_TOUCH } from '@mp/shared';
import type { FileLike } from '../upload/types';
import { EncodeError } from './errors';

/** Bytes read from the start of the file; SOF/IHDR/VP8 headers sit well inside this. */
export const SNIFF_BYTES = 64 * 1024;

export interface Dimensions {
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, i: number): number => (b[i]! << 8) | b[i + 1]!;
const u32be = (b: Uint8Array, i: number): number => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const u16le = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const ascii = (b: Uint8Array, i: number, s: string): boolean => {
  for (let k = 0; k < s.length; k++) if (b[i + k] !== s.charCodeAt(k)) return false;
  return true;
};

function jpegSize(b: Uint8Array): Dimensions | null {
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    while (b[i + 1] === 0xff) i++; // fill bytes
    const marker = b[i + 1]!;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end or scan before any frame header
    if (i + 3 >= b.length) return null;
    const len = u16be(b, i + 2);
    if (len < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 8 >= b.length || len < 8) return null;
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

function pngSize(b: Uint8Array): Dimensions | null {
  if (b.length < 24 || !ascii(b, 12, 'IHDR')) return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function webpSize(b: Uint8Array): Dimensions | null {
  if (b.length < 25) return null;
  if (ascii(b, 12, 'VP8 ')) {
    if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (ascii(b, 12, 'VP8L')) {
    if (b[20] !== 0x2f) return null;
    const b0 = b[21]!;
    const b1 = b[22]!;
    const b2 = b[23]!;
    const b3 = b[24]!;
    return { width: 1 + (b0 | ((b1 & 0x3f) << 8)), height: 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)) };
  }
  if (ascii(b, 12, 'VP8X') && b.length >= 30) return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
  return null;
}

/**
 * Dimensions from the header bytes. `undefined`: not a JPEG/PNG/WebP at all (the post-decode check still applies);
 * `null`: recognised format but the header is unusable (truncated or corrupt).
 */
export function sniffImageSize(bytes: Uint8Array): Dimensions | null | undefined {
  let size: Dimensions | null;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) size = jpegSize(bytes);
  else if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 'PNG')) size = pngSize(bytes);
  else if (bytes.length >= 12 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) size = webpSize(bytes);
  else return undefined;
  if (!size || size.width < 1 || size.height < 1) return null;
  return size;
}

/**
 * Touch / low-memory device. When it cannot be told (no matchMedia, a throwing browser) the stricter touch limit
 * applies, never the desktop one.
 */
export function detectTouch(): boolean {
  try {
    if (typeof matchMedia !== 'function') return true;
    const coarse = matchMedia('(pointer: coarse)').matches;
    const noHover = matchMedia('(hover: none)').matches;
    return coarse || noHover;
  } catch {
    return true;
  }
}

export const maxPixels = (touch: boolean): number => (touch ? MAX_INPUT_MEGAPIXELS_TOUCH : MAX_INPUT_MEGAPIXELS_DESKTOP) * 1_000_000;

/** Throws TOO_MANY_PIXELS above the limit for this device. */
export function assertPixels(width: number, height: number, touch: boolean): void {
  if (width * height > maxPixels(touch)) throw new EncodeError('TOO_MANY_PIXELS', `${width}x${height}`);
}

interface Sliceable {
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}
const canSlice = (file: FileLike): file is FileLike & Sliceable => typeof (file as Partial<Sliceable>).slice === 'function';

async function readHeader(file: FileLike & Sliceable): Promise<Uint8Array> {
  try {
    return new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  } catch (error) {
    throw new EncodeError('CORRUPT', `unreadable: ${String(error)}`);
  }
}

/** Size and header checks; call before decode. Resolves silently when the file may proceed. */
export async function guardInput(file: FileLike, touch: boolean = detectTouch()): Promise<void> {
  if (file.size > MAX_INPUT_FILE_BYTES) throw new EncodeError('TOO_LARGE', `${file.size} bytes`);
  if (!canSlice(file)) return; // not a real Blob: the post-decode check is the only one
  const size = sniffImageSize(await readHeader(file));
  if (size === undefined) return;
  if (size === null) throw new EncodeError('CORRUPT', 'bad header');
  assertPixels(size.width, size.height, touch);
}
