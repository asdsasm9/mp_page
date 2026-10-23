import { CommitRequestSchema, MASTER_MAX_EDGE, fitWithin, planUploadFiles, sumBytes, variantPlan } from '@mp/shared';
import { describe, expect, it } from 'vitest';
import { cs } from '../i18n/cs';
import type { FileLike } from '../upload/types';
import { assembleEncodedPhoto } from './assemble';
import { decodeImage } from './decode';
import { dominantColorOf, FALLBACK_COLOR } from './dominantColor';
import { createEncoder } from './encodePhoto';
import { EncodeError } from './errors';
import { resizeTo } from './resize';
import { assertSurfaceSize, type Drawable, type Rect, type Rgba, type Surface, type SurfaceFactory } from './surface';

// ---------------------------------------------------------------- stub surface

interface StubOptions {
  noWebp?: boolean;
  throwOnSmallPixels?: boolean;
  fill?: [number, number, number, number];
  decodeError?: boolean;
  onDraw?: () => void;
  /** Blob size for a surface at a quality; default w*h/100 (independent of quality). */
  sizeFor?: (w: number, h: number, quality: number, type: string) => number;
}

function stub(natW: number, natH: number, opts: StubOptions = {}) {
  const created: Array<{ w: number; h: number }> = [];
  const encoded: Array<{ w: number; h: number; type: string; quality: number }> = [];
  const puts: Array<{ w: number; h: number }> = [];
  let open = 0;
  const factory: SurfaceFactory = {
    async decode() {
      if (opts.decodeError) throw new Error('bad');
      return { width: natW, height: natH, close() {} } satisfies Drawable;
    },
    createSurface(w, h) {
      assertSurfaceSize(w, h);
      created.push({ w, h });
      open++;
      let closed = false;
      const s: Surface = {
        width: w,
        height: h,
        drawFrom(_src: Drawable, _from: Rect) {
          opts.onDraw?.();
        },
        getRgba(): Rgba {
          if (opts.throwOnSmallPixels) throw new Error('no pixels');
          const data = new Uint8ClampedArray(w * h * 4);
          const f = opts.fill ?? [10, 20, 30, 255];
          for (let i = 0; i < w * h; i++) data.set(f, i * 4);
          return { data, width: w, height: h };
        },
        putRgba() {
          puts.push({ w, h });
        },
        async toBlob(type, quality) {
          encoded.push({ w, h, type, quality });
          const t = type === 'image/webp' && opts.noWebp ? 'image/png' : type;
          const size = opts.sizeFor ? opts.sizeFor(w, h, quality, type) : (w * h) / 100;
          return new Blob([new Uint8Array(Math.max(1, Math.round(size)))], { type: t });
        },
        close() {
          if (!closed) open--;
          closed = true;
        },
      };
      return s;
    },
  };
  return { factory, created, encoded, puts, openCount: () => open };
}

const file = (name = 'a.jpg', type = 'image/jpeg'): FileLike => ({ name, type, size: 1000, lastModified: 1 });
const ID = '11111111-1111-4111-8111-111111111111';
const ALBUM = '22222222-2222-4222-8222-222222222222';

// ---------------------------------------------------------------- WP5-17

describe('decode and resize core', () => {
  const edges = [300, 480, 800, 1000, 1600, 2400, 3000, 4000, 6000];
  for (const long of edges) {
    for (const orient of ['landscape', 'portrait'] as const) {
      it(`${long} px ${orient}: geometry equals variantPlan, no upscaling, no surface above 3000`, async () => {
        const w = orient === 'landscape' ? long : Math.round(long * 0.75);
        const h = orient === 'landscape' ? Math.round(long * 0.75) : long;
        const s = stub(w, h);
        const out = await createEncoder(s.factory).encode(file(), new AbortController().signal);
        const master = fitWithin(w, h);
        const plan = variantPlan(master.w, master.h);
        expect(out.width).toBe(master.w);
        expect(out.height).toBe(master.h);
        expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(Math.min(long, MASTER_MAX_EDGE));
        const v = out.variants;
        expect(Math.abs(v.jpeg.w - plan.jpeg.w)).toBeLessThanOrEqual(1);
        expect(Math.abs(v.jpeg.h - plan.jpeg.h)).toBeLessThanOrEqual(1);
        expect(Math.abs(v.og.w - plan.og.w)).toBeLessThanOrEqual(1);
        expect(Math.abs(v.og.h - plan.og.h)).toBeLessThanOrEqual(1);
        expect(v.webp.map((e) => e.tier)).toEqual(plan.webp.map((e) => e.tier));
        for (const c of s.created) {
          expect(Math.max(c.w, c.h)).toBeLessThanOrEqual(MASTER_MAX_EDGE);
          expect(c.w).toBeGreaterThanOrEqual(1);
        }
        expect(s.openCount()).toBe(0);
      });
    }
  }

  it('never upscales a small image', async () => {
    const s = stub(300, 200);
    const out = await createEncoder(s.factory).encode(file(), new AbortController().signal);
    expect([out.width, out.height]).toEqual([300, 200]);
    expect(out.variants.jpeg.w).toBe(300);
  });

  it('refuses more than 64 megapixels (40 on touch) with the Czech text and creates no surface', async () => {
    const s = stub(12000, 9000);
    await expect(createEncoder(s.factory).encode(file(), new AbortController().signal)).rejects.toMatchObject({
      code: 'TOO_MANY_PIXELS',
      userMessage: 'Fotka má příliš mnoho pixelů (nad 64 MP; na telefonu nad 40 MP).',
    });
    expect(s.created).toHaveLength(0);
  });

  it('aborts between steps', async () => {
    const ctl = new AbortController();
    let draws = 0;
    const s = stub(4000, 3000, {
      onDraw: () => {
        if (++draws === 2) ctl.abort();
      },
    });
    await expect(createEncoder(s.factory).encode(file(), ctl.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(draws).toBeLessThan(6);
    expect(s.openCount()).toBe(0);
  });

  it('an already aborted signal does no work', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const s = stub(400, 300);
    await expect(createEncoder(s.factory).encode(file(), ctl.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.created).toHaveLength(0);
  });

  it('resize halves per step and respects the surface cap for a huge first step', () => {
    const s = stub(9000, 6000);
    const src: Drawable = { width: 9000, height: 6000, close() {} };
    const out = resizeTo(s.factory, src, { x: 0, y: 0, w: 9000, h: 6000 }, 3000, 2000);
    expect([out.width, out.height]).toEqual([3000, 2000]);
    // more than 2x: the source is halved tile by tile, no surface above the cap, intermediates closed
    expect(s.created[0]).toEqual({ w: 3000, h: 2000 });
    expect(s.created.length).toBeGreaterThan(1);
    expect(s.created.every((c) => Math.max(c.w, c.h) <= MASTER_MAX_EDGE)).toBe(true);
    expect(s.openCount()).toBe(1);
    const s2 = stub(1000, 1000);
    resizeTo(s2.factory, { width: 1000, height: 1000, close() {} }, { x: 0, y: 0, w: 1000, h: 1000 }, 100, 100);
    expect(s2.created.map((c) => c.w)).toEqual([500, 250, 125, 100]);
  });

  it('HEIC that the browser cannot decode gets the HEIC text, other failures the generic one', async () => {
    const s = stub(10, 10, { decodeError: true });
    const signal = new AbortController().signal;
    await expect(decodeImage(s.factory, file('IMG_1.HEIC', ''), signal)).rejects.toMatchObject({
      userMessage: 'Tento formát fotka v tomto prohlížeči nejde zpracovat. Zkuste ji uložit jako JPEG.',
    });
    await expect(decodeImage(s.factory, file('x.jpg'), signal)).rejects.toMatchObject({ userMessage: cs.encode.corrupt });
  });

  it('HEIC decodes when the browser can', async () => {
    const s = stub(400, 300);
    const out = await createEncoder(s.factory).encode(file('a.heic', 'image/heic'), new AbortController().signal);
    expect(out.width).toBe(400);
  });
});

// ---------------------------------------------------------------- WP5-18

describe('encoders and variant assembly', () => {
  for (const [w, h] of [[3000, 2250], [4000, 3000], [900, 1200], [300, 200], [1500, 1000]] as const) {
    it(`${w}x${h}: files equal planUploadFiles, bytes_total = sumBytes, commit parses`, async () => {
      const s = stub(w, h);
      const out = await createEncoder(s.factory).encode(file(), new AbortController().signal);
      const planned = planUploadFiles(ID, out.width, out.height).map((f) => `${f.kind}:${f.tier ?? ''}`).sort();
      expect(out.files.map((f) => `${f.kind}:${f.tier ?? ''}`).sort()).toEqual(planned);
      for (const f of out.files) expect(f.bytes).toBe(f.body.size);
      const total = out.files.reduce((a, f) => a + f.bytes, 0);
      expect(sumBytes(out.variants)).toBe(total);
      const parsed = CommitRequestSchema.safeParse({
        photo_id: ID,
        album_id: ALBUM,
        width: out.width,
        height: out.height,
        dominant_color: out.dominantColor,
        variants: out.variants,
        bytes_total: sumBytes(out.variants),
      });
      expect(parsed.success).toBe(true);
      expect(out.files.find((f) => f.kind === 'master')?.body.type).toBe('image/jpeg');
      expect(out.files.filter((f) => f.kind === 'webp').every((f) => f.body.type === 'image/webp')).toBe(true);
    });
  }

  it('a missing 720 tier fails before any network (assembly throws, nothing returned)', async () => {
    const s = stub(3000, 2250);
    const out = await createEncoder(s.factory).encode(file(), new AbortController().signal);
    const part = (kind: string, tier?: number) => {
      const f = out.files.find((x) => x.kind === kind && x.tier === tier)!;
      const v = kind === 'master' ? out.variants.master : kind === 'jpeg' ? out.variants.jpeg : out.variants.og;
      return { w: v.w, h: v.h, blob: f.body };
    };
    const webp = out.variants.webp
      .filter((e) => e.tier !== 720)
      .map((e) => ({ tier: e.tier, w: e.w, h: e.h, blob: out.files.find((f) => f.tier === e.tier)!.body }));
    expect(() => assembleEncodedPhoto({ master: part('master'), webp, jpeg: part('jpeg'), og: part('og') }, 3000, 2250)).toThrow(
      EncodeError,
    );
  });

  it('a non-WebP blob gives the Safari message and no file set', async () => {
    const s = stub(3000, 2250, { noWebp: true });
    let result: unknown = null;
    let error: unknown = null;
    try {
      result = await createEncoder(s.factory).encode(file(), new AbortController().signal);
    } catch (e) {
      error = e;
    }
    expect(result).toBeNull();
    expect(error).toMatchObject({
      code: 'NO_WEBP',
      userMessage: 'Tento prohlížeč neumí vytvářet formát WebP. Použijte Chrome, Edge nebo Firefox.',
    });
    expect(s.openCount()).toBe(0);
  });

  it('a colour failure does not stop the photo; it uploads without a colour', async () => {
    const s = stub(800, 600, { throwOnSmallPixels: true });
    const out = await createEncoder(s.factory).encode(file(), new AbortController().signal);
    expect(out.dominantColor).toBeUndefined();
    expect(out.files.length).toBeGreaterThan(3);
    expect(
      CommitRequestSchema.safeParse({
        photo_id: ID,
        album_id: ALBUM,
        width: out.width,
        height: out.height,
        variants: out.variants,
        bytes_total: sumBytes(out.variants),
      }).success,
    ).toBe(true);
  });

  it('computes the colour from the 16x16 sample', async () => {
    const s = stub(800, 600, { fill: [255, 0, 0, 255] });
    const out = await createEncoder(s.factory).encode(file(), new AbortController().signal);
    expect(out.dominantColor).toBe('#ff0000');
  });
});

// ---------------------------------------------------------------- WP-10 T-261

describe('quality table, adaptive step-down, sharpening, phases', () => {
  const run = async (w: number, h: number, opts: StubOptions = {}, onPhase?: (p: 'previews' | 'detail') => void) => {
    const s = stub(w, h, opts);
    const out = await createEncoder(s.factory).encode(file(), new AbortController().signal, onPhase);
    return { s, out };
  };
  const qualitiesOf = (s: ReturnType<typeof stub>, type: string, w: number) =>
    s.encoded.filter((e) => e.type === type && e.w === w).map((e) => e.quality);

  it('a variant under its cap is encoded exactly once, at the start quality', async () => {
    const { s } = await run(4000, 3000); // 3000x2250 master, default size w*h/100 is far below every cap
    expect(qualitiesOf(s, 'image/webp', 480)).toEqual([0.74]);
    expect(qualitiesOf(s, 'image/webp', 720)).toEqual([0.68]);
    expect(qualitiesOf(s, 'image/webp', 960)).toEqual([0.66]);
    expect(qualitiesOf(s, 'image/webp', 1600)).toEqual([0.8]);
    expect(qualitiesOf(s, 'image/webp', 2400)).toEqual([0.8]);
    expect(qualitiesOf(s, 'image/jpeg', 1600)).toEqual([0.82]);
    expect(qualitiesOf(s, 'image/jpeg', 1200)).toEqual([0.82]);
    expect(qualitiesOf(s, 'image/jpeg', 3000)).toEqual([0.9]);
    expect(s.encoded).toHaveLength(8);
  });

  it('steps down by 0.04 at most 3 times, never below the floor, and keeps the last result when still over the cap', async () => {
    const { s, out } = await run(4000, 3000, { sizeFor: () => 10_000_000 });
    expect(qualitiesOf(s, 'image/webp', 480)).toEqual([0.74, 0.7, 0.66, 0.62]); // 3 retries
    expect(qualitiesOf(s, 'image/webp', 720)).toEqual([0.68, 0.64, 0.6]); // floor 0.60 stops the 4th
    expect(qualitiesOf(s, 'image/webp', 960)).toEqual([0.66, 0.62]);
    expect(qualitiesOf(s, 'image/webp', 1600)).toEqual([0.8, 0.76, 0.72]); // 0.68 is below the 0.70 floor
    expect(qualitiesOf(s, 'image/webp', 2400)).toEqual([0.8, 0.76, 0.72]);
    expect(qualitiesOf(s, 'image/jpeg', 1600)).toEqual([0.82, 0.78]); // 0.74 is below the 0.75 floor
    expect(qualitiesOf(s, 'image/jpeg', 1200)).toEqual([0.82, 0.78, 0.74, 0.7]);
    expect(qualitiesOf(s, 'image/jpeg', 3000)).toEqual([0.9, 0.86, 0.82]); // 0.78 is below the 0.80 floor
    for (const e of s.encoded) expect(e.quality).toBeGreaterThanOrEqual(0.6);
    expect(out.files.every((f) => f.bytes === 10_000_000)).toBe(true); // last result kept, nothing dropped
  });

  it('stops stepping as soon as the result fits the cap', async () => {
    // 720 tier: 80 KB cap; size grows with quality, 0.68 -> 85 KB, 0.64 -> 80 KB (fits, not above the cap)
    const { s } = await run(4000, 3000, { sizeFor: (_w, _h, q, type) => (type === 'image/webp' ? q * 125_000 : 1000) });
    expect(qualitiesOf(s, 'image/webp', 720)).toEqual([0.68, 0.64]);
  });

  it('sharpens the overview tiers, 1600, 2400 and OG, but not the 1600 JPEG or the master', async () => {
    const { s } = await run(4000, 3000);
    expect(s.puts.map((p) => p.w)).toEqual([480, 720, 960, 1600, 2400, 1200]);
  });

  it('reports the two phases in order, the overview set before any detail variant', async () => {
    const calls: string[] = [];
    const s = stub(4000, 3000);
    await createEncoder(s.factory).encode(file(), new AbortController().signal, (p) => calls.push(`${p}@${s.encoded.length}`));
    expect(calls).toEqual(['previews@0', 'detail@3']);
  });

  it('works without a phase callback', async () => {
    const { out } = await run(800, 600);
    expect(out.width).toBe(800);
  });

  it('no output is wider than the master, also for a source more than 2x the master', async () => {
    const { s, out } = await run(7000, 5000); // 35 MP, edge above 2x the master
    expect(Math.max(out.width, out.height)).toBe(3000);
    expect(s.created.every((c) => Math.max(c.w, c.h) <= MASTER_MAX_EDGE)).toBe(true);
    expect(s.encoded.every((e) => e.w <= out.width)).toBe(true);
    expect(s.openCount()).toBe(0);
  });

  it('a 1000 px master gets only tiers that fit and no variant above 1000 px', async () => {
    const { s } = await run(1000, 750);
    expect(s.encoded.every((e) => e.w <= 1000)).toBe(true);
  });
});

// ---------------------------------------------------------------- WP5-19

function rgba(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(px(x, y), (y * w + x) * 4);
  return { data, width: w, height: h };
}

describe('dominantColorOf', () => {
  it('solid red is #ff0000', () => {
    expect(dominantColorOf(rgba(16, 16, () => [255, 0, 0, 255]))).toBe('#ff0000');
  });
  it('red and blue halves give the mean', () => {
    expect(dominantColorOf(rgba(16, 16, (x) => (x < 8 ? [200, 0, 0, 255] : [0, 0, 100, 255])))).toBe('#640032');
  });
  it('a dark image with white borders is not white', () => {
    const c = dominantColorOf(
      rgba(16, 16, (x, y) => (x === 0 || y === 0 || x === 15 || y === 15 ? [255, 255, 255, 255] : [20, 20, 20, 255])),
    );
    expect(c).toMatch(/^#[0-9a-f]{6}$/);
    const r = parseInt(c.slice(1, 3), 16);
    expect(r).toBeLessThan(60);
  });
  it('an all-white image stays white', () => {
    expect(dominantColorOf(rgba(16, 16, () => [255, 255, 255, 255]))).toBe('#ffffff');
  });
  it('empty, fully transparent and NaN input fall back to grey', () => {
    expect(dominantColorOf({ data: [], width: 0, height: 0 })).toBe(FALLBACK_COLOR);
    expect(dominantColorOf(rgba(16, 16, () => [10, 10, 10, 0]))).toBe('#808080');
    expect(dominantColorOf({ data: new Array(16 * 16 * 4).fill(NaN), width: 16, height: 16 })).toBe('#808080');
    expect(dominantColorOf({ data: [1, 2, 3, 255], width: 16, height: 16 })).toBe('#808080');
  });
  it('is deterministic and always lowercase #rrggbb', () => {
    const img = rgba(16, 16, (x, y) => [(x * 17) & 255, (y * 13) & 255, (x * y) & 255, 255]);
    const a = dominantColorOf(img);
    expect(dominantColorOf(img)).toBe(a);
    expect(a).toMatch(/^#[0-9a-f]{6}$/);
  });
});
