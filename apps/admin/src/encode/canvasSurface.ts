/**
 * Browser SurfaceFactory (OffscreenCanvas, else a detached <canvas>). Verified in a real browser by T-135; jsdom has no
 * canvas, so unit tests use a stub instead.
 */
import { EncodeError } from './errors';
import { assertSurfaceSize, type Drawable, type Rect, type Rgba, type Surface, type SurfaceFactory } from './surface';

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const asCanvasImage = (d: Drawable): CanvasImageSource => (d as unknown as { source: CanvasImageSource }).source;

class CanvasSurface implements Drawable, Surface {
  private canvas: AnyCanvas | null;
  private readonly ctx: Ctx;
  readonly width: number;
  readonly height: number;

  constructor(w: number, h: number) {
    assertSurfaceSize(w, h);
    this.width = w;
    this.height = h;
    this.canvas = makeCanvas(w, h);
    const ctx = this.canvas.getContext('2d', { willReadFrequently: false }) as Ctx | null;
    if (!ctx) throw new EncodeError('CORRUPT', 'no 2d context');
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // JPEG has no alpha: transparent PNG pixels would turn black, so start from white.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }

  /** Read by drawFrom of another surface. */
  get source(): CanvasImageSource {
    if (!this.canvas) throw new Error('surface closed');
    return this.canvas as CanvasImageSource;
  }

  drawFrom(src: Drawable, from: Rect, to?: Rect): void {
    const d = to ?? { x: 0, y: 0, w: this.width, h: this.height };
    this.ctx.drawImage(asCanvasImage(src), from.x, from.y, from.w, from.h, d.x, d.y, d.w, d.h);
  }

  getRgba(): Rgba {
    const img = this.ctx.getImageData(0, 0, this.width, this.height);
    return { data: img.data, width: img.width, height: img.height };
  }

  putRgba(data: Uint8ClampedArray): void {
    this.ctx.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, this.width, this.height), 0, 0);
  }

  async toBlob(type: 'image/jpeg' | 'image/webp', quality: number): Promise<Blob> {
    const c = this.canvas;
    if (!c) throw new Error('surface closed');
    if ('convertToBlob' in c) return c.convertToBlob({ type, quality });
    return new Promise<Blob>((resolve, reject) => {
      (c as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new EncodeError('CORRUPT', 'toBlob null'))), type, quality);
    });
  }

  close(): void {
    if (!this.canvas) return;
    this.canvas.width = 0; // releases the backing store early
    this.canvas = null;
  }
}

class BitmapImage implements Drawable {
  constructor(
    private readonly bitmap: ImageBitmap | HTMLImageElement,
    readonly width: number,
    readonly height: number,
    private readonly url?: string,
  ) {}
  get source(): CanvasImageSource {
    return this.bitmap;
  }
  close(): void {
    if ('close' in this.bitmap) this.bitmap.close();
    if (this.url) URL.revokeObjectURL(this.url);
  }
}

export function createCanvasSurfaceFactory(): SurfaceFactory {
  return {
    createSurface: (w, h) => new CanvasSurface(w, h),
    async decode(file: Blob): Promise<Drawable> {
      if (typeof createImageBitmap === 'function') {
        try {
          const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
          return new BitmapImage(bmp, bmp.width, bmp.height);
        } catch {
          // fall through to <img>
        }
      }
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        // <img> drawing applies EXIF orientation by default (image-orientation: from-image).
        return new BitmapImage(img, img.naturalWidth, img.naturalHeight, url);
      } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
      }
    },
  };
}
